-- Drop-fee payments (Stripe) and merchant import support.

-- payment_status:
--   'invoice' : TIN invoices the merchant (used when Stripe is not configured)
--   'unpaid'  : waiting for the merchant to finish Stripe Checkout
--   'paid'    : Stripe confirmed payment
--   'waived'  : TIN HQ waived the fee (e.g. launch promo)
ALTER TABLE treasure_drops ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'invoice';
ALTER TABLE treasure_drops ADD COLUMN stripe_session_id TEXT;
ALTER TABLE treasure_drops ADD COLUMN paid_at TEXT;
CREATE INDEX IF NOT EXISTS idx_drops_stripe ON treasure_drops(stripe_session_id);

CREATE TABLE IF NOT EXISTS payments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id            INTEGER NOT NULL REFERENCES treasure_drops(id),
  merchant_id        INTEGER NOT NULL REFERENCES merchants(id),
  amount_usd         REAL NOT NULL,
  stripe_session_id  TEXT UNIQUE,
  stripe_payment_intent TEXT,
  status             TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','expired','refunded')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  paid_at            TEXT
);

-- Merchants that came in through a bulk import without exact GPS.
ALTER TABLE merchants ADD COLUMN needs_location INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN phone TEXT;
ALTER TABLE merchants ADD COLUMN website TEXT;

-- Local time zone per destination (Polly uses it for "open now" and meal-time tips).
ALTER TABLE destinations ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Cancun';
