-- New treasure types: Services and Transportation. Treasures can also have
-- their own icon image (small PNG/WebP/JPEG data URL) instead of an emoji.
-- SQLite cannot change a CHECK rule in place, so the table is rebuilt with the
-- same ids. Photos are copied aside first because dropping the old table
-- removes them (ON DELETE CASCADE), then they are put back unchanged.
PRAGMA defer_foreign_keys = true;

CREATE TABLE _keep_drop_photos AS SELECT * FROM drop_photos;

CREATE TABLE treasure_drops_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id),
  destination_id   TEXT NOT NULL REFERENCES destinations(id),
  title            TEXT NOT NULL,
  item             TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('Food','Drink','Dessert','Adventure','Shopping','Services','Transportation','Mystery')),
  emoji            TEXT NOT NULL DEFAULT '🎁',
  story_text       TEXT NOT NULL CHECK (length(trim(story_text)) >= 10),
  gps_lat          REAL NOT NULL,
  gps_lng          REAL NOT NULL,
  walking_distance TEXT,
  difficulty       TEXT NOT NULL DEFAULT 'Easy' CHECK (difficulty IN ('Easy','Medium','Hard')),
  reward_value_usd REAL NOT NULL DEFAULT 0,
  is_mystery       INTEGER NOT NULL DEFAULT 0,
  kid_friendly     INTEGER NOT NULL DEFAULT 1,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  remaining        INTEGER NOT NULL,
  fee_usd          REAL NOT NULL DEFAULT 0,
  photo            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','paused','expired','rejected')),
  hunt_id          INTEGER REFERENCES hunts(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at       TEXT,
  payment_status   TEXT NOT NULL DEFAULT 'invoice',
  stripe_session_id TEXT,
  paid_at          TEXT,
  terms            TEXT,
  blocked_by_merchant_id INTEGER REFERENCES merchants(id),
  blocked_at       TEXT,
  icon             TEXT
);

INSERT INTO treasure_drops_new (id, merchant_id, destination_id, title, item, category, emoji, story_text, gps_lat, gps_lng,
  walking_distance, difficulty, reward_value_usd, is_mystery, kid_friendly, quantity, remaining, fee_usd, photo, status, hunt_id,
  created_at, expires_at, payment_status, stripe_session_id, paid_at, terms, blocked_by_merchant_id, blocked_at)
SELECT id, merchant_id, destination_id, title, item, category, emoji, story_text, gps_lat, gps_lng,
  walking_distance, difficulty, reward_value_usd, is_mystery, kid_friendly, quantity, remaining, fee_usd, photo, status, hunt_id,
  created_at, expires_at, payment_status, stripe_session_id, paid_at, terms, blocked_by_merchant_id, blocked_at
FROM treasure_drops;

DROP TABLE treasure_drops;
ALTER TABLE treasure_drops_new RENAME TO treasure_drops;

CREATE INDEX idx_drops_dest_status ON treasure_drops(destination_id, status);
CREATE INDEX idx_drops_merchant ON treasure_drops(merchant_id);
CREATE INDEX idx_drops_stripe ON treasure_drops(stripe_session_id);
CREATE INDEX idx_drops_location ON treasure_drops(status, gps_lat, gps_lng);

INSERT OR IGNORE INTO drop_photos (id, drop_id, position, data_url) SELECT id, drop_id, position, data_url FROM _keep_drop_photos;
DROP TABLE _keep_drop_photos;
