-- vision-sandbox: 100 reusable logical slots for slot-based prompt generation.
-- Slot 1 = Master Blueprint, Slot 2 = Generated Story, Slots 3-100 = prompt records.
-- Apply with: npx wrangler d1 migrations apply vision-sandbox --local|--remote
-- Idempotent: safe to re-run; existing slots and their contents are preserved.

CREATE TABLE IF NOT EXISTS generation_slots (
  slot_id INTEGER PRIMARY KEY CHECK (slot_id BETWEEN 1 AND 100),
  slot_type TEXT NOT NULL CHECK (slot_type IN ('blueprint','story','prompt')),
  user_id TEXT,
  job_id TEXT,
  prompt_index INTEGER,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','claimed','generating','validated','repaired_unverified','failed','cancelled')),
  result TEXT,
  result_ref TEXT,
  blueprint_ref TEXT,
  story_ref TEXT,
  findings TEXT,
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_slots_owner ON generation_slots(user_id, job_id);
CREATE INDEX IF NOT EXISTS idx_slots_status ON generation_slots(status);

-- Larger generation records (blueprint/story/prompt bodies) live here; slots keep references.
CREATE TABLE IF NOT EXISTS generation_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  slot_id INTEGER NOT NULL REFERENCES generation_slots(slot_id),
  kind TEXT NOT NULL CHECK (kind IN ('blueprint','story','prompt')),
  content TEXT NOT NULL,
  checksum TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_job ON generation_records(user_id, job_id, slot_id);

-- Seed the 100 slots one by one, idempotently (INSERT OR IGNORE never overwrites state).
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (1, 'blueprint');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (2, 'story');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (3, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (4, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (5, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (6, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (7, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (8, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (9, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (10, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (11, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (12, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (13, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (14, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (15, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (16, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (17, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (18, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (19, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (20, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (21, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (22, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (23, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (24, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (25, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (26, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (27, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (28, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (29, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (30, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (31, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (32, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (33, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (34, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (35, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (36, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (37, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (38, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (39, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (40, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (41, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (42, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (43, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (44, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (45, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (46, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (47, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (48, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (49, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (50, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (51, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (52, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (53, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (54, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (55, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (56, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (57, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (58, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (59, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (60, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (61, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (62, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (63, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (64, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (65, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (66, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (67, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (68, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (69, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (70, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (71, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (72, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (73, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (74, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (75, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (76, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (77, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (78, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (79, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (80, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (81, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (82, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (83, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (84, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (85, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (86, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (87, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (88, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (89, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (90, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (91, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (92, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (93, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (94, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (95, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (96, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (97, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (98, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (99, 'prompt');
INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (100, 'prompt');
