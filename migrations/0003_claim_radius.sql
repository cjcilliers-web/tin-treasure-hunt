-- Explorers must be physically within this many metres of a treasure to claim it.
-- Set by TIN HQ in Settings.
INSERT OR IGNORE INTO settings(key, value) VALUES ('claim_radius_m', '10');
-- Where the explorer was standing when they claimed (proof of presence).
ALTER TABLE claims ADD COLUMN claim_lat REAL;
ALTER TABLE claims ADD COLUMN claim_lng REAL;
ALTER TABLE claims ADD COLUMN claim_distance_m INTEGER;
