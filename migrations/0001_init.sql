-- TIN Treasure Hunt — initial schema (Cloudflare D1 / SQLite)
-- Tables named in the build spec: tin_users, tin_user_sessions, merchants,
-- treasure_drops, redemptions, redemption_ratings, treasure_hunt_credits.
-- Supporting tables: destinations, claims, redemption_proofs,
-- treasure_hunt_credit_ledger, hunts, raffles, raffle_entries, settings.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS destinations (
  id            TEXT PRIMARY KEY,               -- slug, e.g. 'cozumel'
  name          TEXT NOT NULL,
  country       TEXT NOT NULL,
  center_lat    REAL NOT NULL,
  center_lng    REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pilot' CHECK (status IN ('pilot','launched','paused')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Shared account table across TIN Commerce, Treasure Hunt and Spin & Win.
CREATE TABLE IF NOT EXISTS tin_users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  password_hash   TEXT NOT NULL,                -- base64 PBKDF2-SHA256 output
  password_salt   TEXT NOT NULL,                -- base64 16-byte salt
  password_iter   INTEGER NOT NULL DEFAULT 100000 CHECK (password_iter <= 100000),
  role            TEXT NOT NULL DEFAULT 'traveler' CHECK (role IN ('traveler','merchant','admin')),
  merchant_id     INTEGER REFERENCES merchants(id),
  language        TEXT NOT NULL DEFAULT 'en',
  home_destination TEXT REFERENCES destinations(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_login_at   TEXT
);

CREATE TABLE IF NOT EXISTS tin_user_sessions (
  token_hash    TEXT PRIMARY KEY,               -- SHA-256 of the cookie token
  user_id       INTEGER NOT NULL REFERENCES tin_users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at    TEXT NOT NULL,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON tin_user_sessions(user_id);

-- In the live TIN platform this table already exists; the columns below are
-- what Treasure Hunt reads. Merge rather than recreate when integrating.
CREATE TABLE IF NOT EXISTS merchants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_id TEXT NOT NULL REFERENCES destinations(id),
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  address       TEXT,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  hours         TEXT,
  contact_email TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','declined')),
  is_sample     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS treasure_drops (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id),
  destination_id   TEXT NOT NULL REFERENCES destinations(id),
  title            TEXT NOT NULL,               -- "The Captain's Burger"
  item             TEXT NOT NULL,               -- "Free burger"
  category         TEXT NOT NULL CHECK (category IN ('Food','Drink','Dessert','Adventure','Shopping','Mystery')),
  emoji            TEXT NOT NULL DEFAULT '🎁',
  story_text       TEXT NOT NULL CHECK (length(trim(story_text)) >= 10),
  gps_lat          REAL NOT NULL,
  gps_lng          REAL NOT NULL,
  walking_distance TEXT,                        -- merchant's note, e.g. "5 min from the ferry pier"
  difficulty       TEXT NOT NULL DEFAULT 'Easy' CHECK (difficulty IN ('Easy','Medium','Hard')),
  reward_value_usd REAL NOT NULL DEFAULT 0,
  is_mystery       INTEGER NOT NULL DEFAULT 0,
  kid_friendly     INTEGER NOT NULL DEFAULT 1,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  remaining        INTEGER NOT NULL,
  fee_usd          REAL NOT NULL DEFAULT 0,     -- $1 per drop at creation time
  photo            TEXT,                        -- small data URL (<=150 KB) for the pilot
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','expired','rejected')),
  hunt_id          INTEGER REFERENCES hunts(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_drops_dest_status ON treasure_drops(destination_id, status);
CREATE INDEX IF NOT EXISTS idx_drops_merchant ON treasure_drops(merchant_id);

-- A claim is the one-time QR code a traveler shows at the counter.
CREATE TABLE IF NOT EXISTS claims (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES tin_users(id),
  drop_id     INTEGER NOT NULL REFERENCES treasure_drops(id),
  code        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','redeemed','abandoned','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_open ON claims(user_id, drop_id) WHERE status IN ('claimed','redeemed');

CREATE TABLE IF NOT EXISTS redemption_proofs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('photo','signature')),
  data_url    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- The redemption timestamp is the proof record.
CREATE TABLE IF NOT EXISTS redemptions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id               INTEGER NOT NULL UNIQUE REFERENCES claims(id),
  user_id                INTEGER NOT NULL REFERENCES tin_users(id),
  drop_id                INTEGER NOT NULL REFERENCES treasure_drops(id),
  merchant_id            INTEGER NOT NULL REFERENCES merchants(id),
  confirmed_by           INTEGER NOT NULL REFERENCES tin_users(id),
  redeemed_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  confirmation_type      TEXT NOT NULL CHECK (confirmation_type IN ('photo','signature')),
  confirmation_reference TEXT NOT NULL,          -- 'proof:<redemption_proofs.id>'
  credits_awarded        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_red_user ON redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_red_time ON redemptions(redeemed_at);
CREATE INDEX IF NOT EXISTS idx_red_merchant ON redemptions(merchant_id);

CREATE TABLE IF NOT EXISTS redemption_ratings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  redemption_id  INTEGER NOT NULL UNIQUE REFERENCES redemptions(id),
  ease_score     INTEGER NOT NULL CHECK (ease_score BETWEEN 1 AND 10),
  speed_score    INTEGER NOT NULL CHECK (speed_score BETWEEN 1 AND 10),
  overall_score  INTEGER NOT NULL CHECK (overall_score BETWEEN 1 AND 10),
  comment        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Isolated pool: never mixed with TIN Commerce or Spin & Win credits.
CREATE TABLE IF NOT EXISTS treasure_hunt_credits (
  user_id       INTEGER PRIMARY KEY REFERENCES tin_users(id),
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  last_updated  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS treasure_hunt_credit_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES tin_users(id),
  amount      INTEGER NOT NULL,
  reason      TEXT NOT NULL,                    -- 'redemption', 'raffle', 'admin'
  ref         TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON treasure_hunt_credit_ledger(user_id);

CREATE TABLE IF NOT EXISTS hunts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_id  TEXT NOT NULL REFERENCES destinations(id),
  name            TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '🗺️',
  tagline         TEXT,
  starts_on       TEXT,
  ends_on         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','live','ended'))
);

CREATE TABLE IF NOT EXISTS raffles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start      TEXT NOT NULL,                -- inclusive, ISO UTC
  week_end        TEXT NOT NULL,                -- exclusive, ISO UTC (the Sunday 14:00 draw time)
  drawn_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  prize_credits   INTEGER NOT NULL,
  entrant_count   INTEGER NOT NULL,
  winner_user_id  INTEGER REFERENCES tin_users(id),
  trigger         TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron','manual')),
  UNIQUE (week_end)
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('credits_per_find', '10'),
  ('raffle_prize_credits', '500'),
  ('drop_price_usd', '1'),
  ('claim_hours', '24');

INSERT OR IGNORE INTO destinations(id, name, country, center_lat, center_lng, status)
VALUES ('cozumel', 'Cozumel', 'Mexico', 20.5090, -86.9490, 'pilot');
