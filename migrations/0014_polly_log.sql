-- What explorers ask Polly and what she answered (text only, no AI cost), for TIN HQ to read
-- and turn into better questions & answers.
CREATE TABLE IF NOT EXISTS polly_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES tin_users(id),
  lang        TEXT,
  source      TEXT,              -- button | typed | voice
  question    TEXT NOT NULL,
  answer      TEXT,
  hq_answer   INTEGER NOT NULL DEFAULT 0,  -- 1 = Polly used an answer written by TIN HQ
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_polly_log_time ON polly_log(created_at);
