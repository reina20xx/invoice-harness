-- Invoice Harness D1 Schema: Qualified Invoice (T-Number), Auto-Reconciliation & Dunning Engine

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  payer_kana TEXT NOT NULL,
  item_title TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax_rate INTEGER NOT NULL DEFAULT 10,
  tax_amount INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  registration_number TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  reconciled_at TEXT,
  matched_tx_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  sender_kana TEXT NOT NULL,
  amount INTEGER NOT NULL,
  deposited_at TEXT NOT NULL,
  matched_invoice_id TEXT,
  match_confidence INTEGER NOT NULL DEFAULT 0,
  match_reason TEXT
);
