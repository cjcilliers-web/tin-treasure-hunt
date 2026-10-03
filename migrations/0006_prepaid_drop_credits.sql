-- Prepaid drop credits: merchants buy drops upfront (single drops or packs) and spend one credit per drop.
-- Replaces the 30-day free trial. TIN HQ can give free drops; new merchants get a welcome gift.
ALTER TABLE merchants ADD COLUMN drop_credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN welcome_granted INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS merchant_drop_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('welcome','gift','purchase','drop','refund','adjust')),
  ref         TEXT,
  note        TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_drop_ledger_merchant ON merchant_drop_ledger(merchant_id, id);

CREATE TABLE IF NOT EXISTS credit_purchases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id           INTEGER NOT NULL REFERENCES merchants(id),
  drops                 INTEGER NOT NULL,
  amount_usd            REAL NOT NULL,
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  status                TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','expired','refunded')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  paid_at               TEXT
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('welcome_drops', '25'),
  ('drop_packs', '[{"drops":100,"usd":10}]');

-- Existing active (non-sample) merchants get the welcome gift once.
INSERT INTO merchant_drop_ledger(merchant_id, delta, reason, note)
  SELECT id, 25, 'welcome', 'Welcome drops (switch from free trial to prepaid drops)' FROM merchants WHERE status = 'active' AND is_sample = 0;
UPDATE merchants SET drop_credits = drop_credits + 25, welcome_granted = 1 WHERE status = 'active' AND is_sample = 0;
