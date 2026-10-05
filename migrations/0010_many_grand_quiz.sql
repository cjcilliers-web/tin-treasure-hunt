-- Many Grand Treasures at once, each optionally given by a sponsor (e.g. an Effy Jewelers gemstone).
-- A sponsor's own videos fill the sponsor's treasure; all other videos fill TIN's own ("house") treasure.
-- Polly's quiz: questions about the sponsor; a right answer opens a bonus clue for that player.
ALTER TABLE grand_treasures ADD COLUMN sponsor_merchant_id INTEGER REFERENCES merchants(id);
ALTER TABLE grand_treasures ADD COLUMN sponsor_name TEXT;
CREATE INDEX IF NOT EXISTS idx_grand_status_sponsor ON grand_treasures(status, sponsor_merchant_id);

CREATE TABLE IF NOT EXISTS grand_quiz (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  grand_id    INTEGER NOT NULL REFERENCES grand_treasures(id),
  question    TEXT NOT NULL,
  options     TEXT NOT NULL,                -- JSON array of 2–4 answers
  answer      INTEGER NOT NULL,             -- index of the right answer (never sent to players)
  bonus_clue  TEXT NOT NULL,                -- opens for a player who answers right
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_quiz_grand ON grand_quiz(grand_id);

CREATE TABLE IF NOT EXISTS grand_quiz_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id     INTEGER NOT NULL REFERENCES grand_quiz(id),
  grand_id    INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES tin_users(id),
  choice      INTEGER NOT NULL,
  correct     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (quiz_id, user_id)
);
