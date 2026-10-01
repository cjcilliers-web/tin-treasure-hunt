-- Treasures look and work like TIN Coupons: merchant logo, photo gallery,
-- terms, and an 8-digit backup code next to the QR.
ALTER TABLE merchants ADD COLUMN logo TEXT;              -- small data URL (<=120 KB)
ALTER TABLE treasure_drops ADD COLUMN terms TEXT;        -- merchant's own conditions
CREATE TABLE IF NOT EXISTS drop_photos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  drop_id   INTEGER NOT NULL REFERENCES treasure_drops(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  data_url  TEXT NOT NULL,
  UNIQUE (drop_id, position)
);
-- Existing single photos become photo #1 of the gallery.
INSERT OR IGNORE INTO drop_photos(drop_id, position, data_url)
  SELECT id, 0, photo FROM treasure_drops WHERE photo IS NOT NULL;
