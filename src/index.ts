import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleMcpRequest } from './agent/mcp';

export type Bindings = {
  DB: D1Database;
  STATIC_HTML?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', cors());

export function normalizeBankKana(raw: string): string {
  return (raw || '')
    .replace(/カ）|（カ|カ\)|\(カ|カブシキガイシャ|ゴウドウガイシャ|ド）|（ド/g, '')
    .replace(/[\s　・()（）\-]/g, '')
    .trim()
    .toUpperCase();
}

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'invoice-harness',
    architecture: 'Cloudflare Workers + D1 + Bank Auto-Reconciliation + MCP',
    cost: '¥0/month (Replaces Misoca / MoneyForward Cloud Invoice / MakeLeaps)',
  });
});

app.get('/api/dashboard', async (c) => {
  const invoices = (await c.env.DB.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all()).results || [];
  const txs = (await c.env.DB.prepare('SELECT * FROM bank_transactions ORDER BY deposited_at DESC').all()).results || [];

  const totalBilled = invoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0);
  const totalPaid = invoices
    .filter((i: any) => i.status === 'paid')
    .reduce((s: number, i: any) => s + Number(i.total_amount), 0);
  const unpaidCount = invoices.filter((i: any) => i.status === 'unpaid').length;

  return c.json({
    metrics: {
      total_invoices: invoices.length,
      total_billed_jpy: totalBilled,
      total_reconciled_jpy: totalPaid,
      unpaid_count: unpaidCount,
      estimated_saas_saved_jpy: 19800,
    },
    invoices,
    bank_transactions: txs,
  });
});

// Create Qualified Invoice (T-Number compliant, 10% tax auto-calc)
app.post('/api/invoices/create', async (c) => {
  const body = await c.req.json<{
    client_name: string;
    client_email: string;
    payer_kana: string;
    item_title: string;
    subtotal: number;
    due_date?: string;
    registration_number?: string;
  }>();

  if (!body.client_name || !body.subtotal) {
    return c.json({ error: 'client_name and subtotal are required' }, 400);
  }

  const subtotal = Number(body.subtotal);
  const taxRate = 10;
  const taxAmount = Math.floor(subtotal * 0.1);
  const totalAmount = subtotal + taxAmount;
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const invNumber = `INV-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO invoices (id, invoice_number, client_name, client_email, payer_kana, item_title, subtotal, tax_rate, tax_amount, total_amount, registration_number, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`
  )
    .bind(
      id,
      invNumber,
      body.client_name,
      body.client_email || 'accounting@example.co.jp',
      body.payer_kana || 'カ）クライアント',
      body.item_title || 'システム開発・技術顧問料',
      subtotal,
      taxRate,
      taxAmount,
      totalAmount,
      body.registration_number || 'T1010001234567',
      body.due_date || '2026-11-30',
      now
    )
    .run();

  return c.json({
    ok: true,
    invoice: {
      id,
      invoice_number: invNumber,
      client_name: body.client_name,
      payer_kana: body.payer_kana,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      registration_number: body.registration_number || 'T1010001234567',
      status: 'unpaid',
    },
  });
});

// Bank Deposit Webhook / CSV Auto-Reconciliation Engine
app.post('/api/reconcile/deposit', async (c) => {
  const body = await c.req.json<{ sender_kana: string; amount: number }>();
  if (!body.sender_kana || !body.amount) {
    return c.json({ error: 'sender_kana and amount are required' }, 400);
  }

  const depositAmount = Number(body.amount);
  const normSender = normalizeBankKana(body.sender_kana);
  const unpaidList =
    (await c.env.DB.prepare("SELECT * FROM invoices WHERE status = 'unpaid'").all()).results || [];

  let matchedInv: any = null;
  let confidence = 0;
  let reason = '一致する未入金請求書なし';

  for (const inv of unpaidList as any[]) {
    const normPayer = normalizeBankKana(inv.payer_kana);
    const kanaMatched = normSender.includes(normPayer) || normPayer.includes(normSender);
    const exactAmount = Number(inv.total_amount) === depositAmount;
    // Also detect bank transfer fee deduction (e.g., 220, 330, 440, 550, 660, 770, 880 JPY)
    const diff = Number(inv.total_amount) - depositAmount;
    const isFeeDeducted = diff > 0 && diff <= 880 && diff % 110 === 0;

    if (kanaMatched && exactAmount) {
      matchedInv = inv;
      confidence = 100;
      reason = `振込名義カナ一致 (${normPayer}) ＆ 税込請求額完全一致 (¥${depositAmount.toLocaleString()})`;
      break;
    } else if (kanaMatched && isFeeDeducted) {
      matchedInv = inv;
      confidence = 95;
      reason = `振込名義カナ一致 (${normPayer}) ＆ 先方振込手数料差引判定 (-¥${diff} 手数料調整済)`;
      break;
    } else if (exactAmount && !matchedInv) {
      matchedInv = inv;
      confidence = 80;
      reason = `税込請求額完全一致 (¥${depositAmount.toLocaleString()}) による自動照合`;
    }
  }

  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO bank_transactions (id, sender_kana, amount, deposited_at, matched_invoice_id, match_confidence, match_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(txId, body.sender_kana, depositAmount, now, matchedInv ? matchedInv.id : null, confidence, reason)
    .run();

  if (matchedInv && confidence >= 80) {
    await c.env.DB.prepare(
      `UPDATE invoices SET status = 'paid', reconciled_at = ?, matched_tx_id = ? WHERE id = ?`
    )
      .bind(now, txId, matchedInv.id)
      .run();
  }

  return c.json({
    ok: true,
    reconciled: Boolean(matchedInv && confidence >= 80),
    transaction_id: txId,
    matched_invoice_id: matchedInv ? matchedInv.id : null,
    matched_invoice_number: matchedInv ? matchedInv.invoice_number : null,
    match_confidence: confidence,
    match_reason: reason,
  });
});

app.post('/mcp', async (c) => {
  const body = await c.req.json();
  const res = await handleMcpRequest(body, c.env);
  return c.json(res);
});

app.get('/', (c) => {
  if (c.env.STATIC_HTML) {
    return c.html(c.env.STATIC_HTML);
  }
  return c.text('Invoice Harness API is running.');
});

export default app;
