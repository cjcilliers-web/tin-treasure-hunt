-- TIN Video Ad Network: the same sponsor videos also play in TIN Spin & Win (tincommerce.com).
-- Spin & Win players are TIN accounts, not Treasure Hunt accounts, so their finished views are
-- recorded here. Each counts once per video per player per day, charges the advertiser the same
-- HQ price and adds the same pot share to the live Grand Treasure.
CREATE TABLE IF NOT EXISTS ad_network_views (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id      INTEGER NOT NULL REFERENCES sponsor_videos(id),
  source        TEXT NOT NULL DEFAULT 'spin',
  tin_user_id   TEXT NOT NULL,
  tin_view_id   TEXT NOT NULL UNIQUE,
  day           TEXT NOT NULL,
  charged_cents INTEGER NOT NULL DEFAULT 0,
  pot_cents     INTEGER NOT NULL DEFAULT 0,
  grand_id      INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (video_id, source, tin_user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_adnet_user_day ON ad_network_views(source, tin_user_id, day);
CREATE INDEX IF NOT EXISTS idx_adnet_video ON ad_network_views(video_id);
