-- Grand Treasure paid for by sponsor-video views.
-- Merchants top up a video budget and add a 15- or 30-second YouTube video that ends with their
-- coupon. Each finished view charges the merchant the HQ price for that length, and a share
-- (default 5 cents) goes into the live Grand Treasure's pot. As the pot grows, clues unlock and a
-- search circle on the map shrinks toward the secret spot. When the pot reaches the goal, the first
-- explorer who reaches the spot and claims it wins the prize.

ALTER TABLE merchants ADD COLUMN video_balance_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS video_budget_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id  INTEGER NOT NULL REFERENCES merchants(id),
  delta_cents  INTEGER NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('purchase','view','gift','adjust')),
  ref          TEXT,
  note         TEXT,
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_video_ledger_merchant ON video_budget_ledger(merchant_id, id);

CREATE TABLE IF NOT EXISTS video_budget_purchases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id           INTEGER NOT NULL REFERENCES merchants(id),
  amount_cents          INTEGER NOT NULL,
  stripe_session_id     TEXT UNIQUE,
  stripe_payment_intent TEXT,
  status                TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','expired')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  paid_at               TEXT
);

CREATE TABLE IF NOT EXISTS sponsor_videos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id   INTEGER REFERENCES merchants(id),          -- NULL = outside sponsor added by TIN HQ
  sponsor_name  TEXT NOT NULL,
  title         TEXT NOT NULL,
  youtube_id    TEXT NOT NULL,
  length_s      INTEGER NOT NULL DEFAULT 15 CHECK (length_s IN (15, 30)),
  coupon_text   TEXT,                                       -- shown when the video ends
  link_url      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','rejected')),
  created_by    INTEGER REFERENCES tin_users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_status ON sponsor_videos(status);

CREATE TABLE IF NOT EXISTS video_watches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      INTEGER NOT NULL REFERENCES sponsor_videos(id),
  user_id       INTEGER NOT NULL REFERENCES tin_users(id),
  day           TEXT NOT NULL,                              -- UTC date; one counted view per video per person per day
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  completed_at  TEXT,
  charged_cents INTEGER NOT NULL DEFAULT 0,
  pot_cents     INTEGER NOT NULL DEFAULT 0,
  grand_id      INTEGER,
  link_clicked  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (video_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_watches_user_day ON video_watches(user_id, day);

CREATE TABLE IF NOT EXISTS grand_treasures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,                            -- e.g. "A brand-new scooter"
  prize_text      TEXT,
  emoji           TEXT NOT NULL DEFAULT '🛵',
  photo_url       TEXT,
  area_name       TEXT,                                     -- e.g. "Cozumel"
  goal_cents      INTEGER NOT NULL CHECK (goal_cents > 0),
  pot_cents       INTEGER NOT NULL DEFAULT 0,
  views           INTEGER NOT NULL DEFAULT 0,
  secret_lat      REAL NOT NULL,                            -- never sent to explorers
  secret_lng      REAL NOT NULL,
  start_radius_m  INTEGER NOT NULL DEFAULT 3000,
  final_radius_m  INTEGER NOT NULL DEFAULT 40,
  bearing_deg     REAL NOT NULL,                            -- fixed random offset so the circle never centres on the spot
  offset_frac     REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','full','found','closed')),
  found_by        INTEGER REFERENCES tin_users(id),
  found_at        TEXT,
  claim_code      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS grand_clues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  grand_id    INTEGER NOT NULL REFERENCES grand_treasures(id),
  unlock_pct  INTEGER NOT NULL CHECK (unlock_pct BETWEEN 0 AND 100),
  text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clues_grand ON grand_clues(grand_id, unlock_pct);

INSERT OR IGNORE INTO settings(key, value) VALUES ('video_price_15_cents', '10');
INSERT OR IGNORE INTO settings(key, value) VALUES ('video_price_30_cents', '15');
INSERT OR IGNORE INTO settings(key, value) VALUES ('video_pot_share_cents', '5');
INSERT OR IGNORE INTO settings(key, value) VALUES ('video_daily_limit', '20');
