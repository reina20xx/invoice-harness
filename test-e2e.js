const BASE = process.env.BASE_URL || 'http://localhost:8792';

async function runTests() {
  console.log('=== Invoice Harness E2E Test Suite ===');

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (health.status !== 'ok') throw new Error('Health check failed');
  console.log('✅ 1. Health check passed:', health.service);

  const invRes = await fetch(`${BASE}/api/invoices/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: '株式会社テックパートナーズ',
      payer_kana: 'カ）テツクパートナーズ',
      subtotal: 500000,
      item_title: 'AIエージェント導入支援費',
    }),
  }).then((r) => r.json());

  if (!invRes.ok || invRes.invoice.total_amount !== 550000) {
    throw new Error('Invoice creation failed: ' + JSON.stringify(invRes));
  }
  console.log(`✅ 2. Qualified Invoice issued (${invRes.invoice.invoice_number}): ¥${invRes.invoice.total_amount.toLocaleString()} (incl. 10% tax)`);

  // Reconcile with 550 JPY bank fee deduction & slightly different kana notation
  const recRes = await fetch(`${BASE}/api/reconcile/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender_kana: 'カ)テツクパートナーズ',
      amount: 549450, // 550,000 - 550 bank transfer fee
    }),
  }).then((r) => r.json());

  if (!recRes.ok || !recRes.reconciled || recRes.matched_invoice_id !== invRes.invoice.id) {
    throw new Error('Auto-reconciliation failed: ' + JSON.stringify(recRes));
  }
  console.log(`✅ 3. Bank Auto-Reconciliation passed (confidence ${recRes.match_confidence}%): ${recRes.match_reason}`);

  // Test MCP dunning generator
  const mcpRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'generate_dunning_message',
        arguments: { invoice_id: invRes.invoice.id },
      },
    }),
  }).then((r) => r.json());

  const dunning = JSON.parse(mcpRes.result.content[0].text);
  if (!dunning.subject.includes(invRes.invoice.invoice_number)) {
    throw new Error('MCP dunning message failed');
  }
  console.log('✅ 4. MCP tool generate_dunning_message verified:', dunning.subject);

  console.log('🎉 ALL INVOICE HARNESS E2E TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ E2E Test failed:', err);
  process.exit(1);
});
