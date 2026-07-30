-- Credit balances, keyed by the email Stripe collects at checkout.
CREATE TABLE credits (
  email TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Audit trail for every balance change (purchase, spend, refund). Not
-- consulted for balance math (credits.balance is the source of truth) but
-- needed the first time a customer asks "where did my credits go".
CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  stripe_event_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ledger_email ON ledger(email);

-- Stripe can retry a webhook delivery; this makes crediting a given
-- checkout.session.completed event idempotent (a second delivery with the
-- same event id fails the unique constraint instead of double-crediting).
CREATE UNIQUE INDEX idx_ledger_stripe_event ON ledger(stripe_event_id) WHERE stripe_event_id IS NOT NULL;
