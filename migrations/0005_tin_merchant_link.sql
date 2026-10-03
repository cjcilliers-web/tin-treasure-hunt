-- Link Treasure Hunt merchants to TIN Commerce merchants switched on by TIN HQ.
-- trial_ends_at: drops are free (payment waived) until this time; afterwards $1/drop via Stripe.
ALTER TABLE merchants ADD COLUMN tin_merchant_id INTEGER;
ALTER TABLE merchants ADD COLUMN trial_ends_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS merchants_tin_merchant_id ON merchants(tin_merchant_id);
