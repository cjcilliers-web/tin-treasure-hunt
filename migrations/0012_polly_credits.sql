-- Polly Credits: every explorer gets a starting amount; Polly's AI use (voice, listening,
-- understanding) is charged at Cloudflare's real cost. 1 Polly Credit = 100 Cloudflare "neurons"
-- (about US$0.0011). Explorers can top up with Stripe. The Polly Admin wallet records money that
-- pays for Cloudflare (top-ups now; a share of redemptions later).
CREATE TABLE IF NOT EXISTS polly_credits (
  user_id         INTEGER PRIMARY KEY REFERENCES tin_users(id),
  granted_neurons INTEGER NOT NULL DEFAULT 0,
  used_neurons    INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS polly_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES tin_users(id),
  kind       TEXT NOT NULL,            -- voice | listen | think
  model      TEXT NOT NULL,
  units      REAL NOT NULL DEFAULT 0,  -- characters, audio minutes or tokens
  neurons    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_polly_usage_time ON polly_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_polly_usage_user ON polly_usage(user_id, created_at);
CREATE TABLE IF NOT EXISTS polly_topups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES tin_users(id),
  credits           INTEGER NOT NULL,
  amount_usd        REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'created',
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  paid_at           TEXT
);
CREATE TABLE IF NOT EXISTS polly_wallet (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_usd  REAL NOT NULL,
  reason      TEXT NOT NULL,            -- topup | redemption_share | cloudflare_cost | adjustment
  ref         TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('polly_start_credits', '100');
INSERT OR IGNORE INTO settings(key, value) VALUES ('polly_packs', '[{"credits":1500,"usd":5},{"credits":3500,"usd":10}]');
