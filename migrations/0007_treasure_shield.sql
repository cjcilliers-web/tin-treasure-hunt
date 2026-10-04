-- TIN Treasure Shield: a merchant protects a circle around their business (or another spot).
-- When another merchant's treasure goes live inside it, the shield owner is told on their
-- Treasure Hunt message board and can leave it or block it. A blocked treasure is taken down,
-- its unused drop credits go back to the merchant who dropped it, and that merchant is told.

CREATE TABLE IF NOT EXISTS treasure_shields (
  merchant_id  INTEGER PRIMARY KEY REFERENCES merchants(id),
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  radius_m     INTEGER NOT NULL CHECK (radius_m > 0),
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS merchant_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id  INTEGER NOT NULL REFERENCES merchants(id),  -- who reads it
  kind         TEXT NOT NULL CHECK (kind IN ('shield_alert','drop_blocked','drop_left')),
  drop_id      INTEGER REFERENCES treasure_drops(id),
  drop_lat     REAL,
  drop_lng     REAL,
  body         TEXT NOT NULL,
  state        TEXT CHECK (state IN ('open','left','blocked','closed')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  read_at      TEXT,
  acted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_merchant_messages ON merchant_messages(merchant_id, id);
CREATE INDEX IF NOT EXISTS idx_merchant_messages_drop ON merchant_messages(drop_id, kind);

-- Blocked treasures keep status 'rejected' (no new drop status needed) and record who blocked them.
ALTER TABLE treasure_drops ADD COLUMN blocked_by_merchant_id INTEGER REFERENCES merchants(id);
ALTER TABLE treasure_drops ADD COLUMN blocked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_drops_location ON treasure_drops(status, gps_lat, gps_lng);

INSERT OR IGNORE INTO settings(key, value) VALUES ('shield_max_radius_m', '150');
