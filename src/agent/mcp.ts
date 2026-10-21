import type { Bindings } from '../index';

export async function handleMcpRequest(req: any, env: Bindings) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'invoice-harness-mcp', version: '1.0.0' },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'list_invoices',
            description: '適格請求書（インボイス）の一覧と入金消込ステータスを取得します',
            inputSchema: {
              type: 'object',
              properties: {
                status: { type: 'string', description: 'unpaid または paid（任意）' },
              },
            },
          },
          {
            name: 'generate_dunning_message',
            description: '指定した未入金請求書IDに対して、丁寧な入金確認・督促リマインド文面を生成します',
            inputSchema: {
              type: 'object',
              required: ['invoice_id'],
              properties: { invoice_id: { type: 'string' } },
            },
          },
        ],
      },
    };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'list_invoices') {
      const q = args.status
        ? env.DB.prepare('SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC').bind(args.status)
        : env.DB.prepare('SELECT * FROM invoices ORDER BY created_at DESC');
      const res = await q.all();
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(res.results || [], null, 2) }] },
      };
    }

    if (toolName === 'generate_dunning_message') {
      const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(args.invoice_id).first<any>();
      if (!inv) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Invoice not found' }] } };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  invoice_number: inv.invoice_number,
                  client_name: inv.client_name,
                  total_amount: inv.total_amount,
                  subject: `【ご確認】ご請求書（${inv.invoice_number}）のお振込状況につきまして`,
                  body: `${inv.client_name} ご担当者様\n\nいつも大変お世話になっております。\n先日お送りいたしました適格請求書「${inv.invoice_number}（件名：${inv.item_title} / ご請求金額：¥${Number(inv.total_amount).toLocaleString()} 税込）」につきまして、お支払期日（${inv.due_date}）時点でのご入金確認が取れておりませんでしたため、念のためご連絡いたしました。\n本メールと行き違いでお手続きいただいておりましたら何卒ご容赦ください。`,
                },
                null,
                2
              ),
            },
          ],
        },
      };
    }
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}
