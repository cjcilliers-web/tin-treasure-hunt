-- Free Polly Credits given by TIN HQ. Unseen gifts light up a notification in Treasure Hunt
-- and in the TIN User Cockpit; they go off when the explorer opens the notification in Treasure Hunt.
CREATE TABLE IF NOT EXISTS polly_gifts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES tin_users(id),
  credits    INTEGER NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  seen_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_polly_gifts_user ON polly_gifts(user_id, seen_at);
