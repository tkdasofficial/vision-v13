-- vision-sandbox: Long Context Generation store (temporary output generation).
-- Apply with: npx wrangler d1 migrations apply vision-sandbox --local|--remote

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  instructions TEXT NOT NULL,
  model_config TEXT NOT NULL DEFAULT '{}',
  settings TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','planning','generating','validating','assembling','completed','failed','cancelled')),
  total_chunks INTEGER NOT NULL DEFAULT 0,
  completed_chunks INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_user ON generation_jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_status ON generation_jobs(status);

CREATE TABLE IF NOT EXISTS generation_plans (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  outline TEXT NOT NULL,
  chunk_structure TEXT NOT NULL,
  dependencies TEXT NOT NULL DEFAULT '{}',
  context_policy TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, version)
);

CREATE TABLE IF NOT EXISTS generation_chunks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  section_id TEXT NOT NULL,
  instructions TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','validating','retrying','completed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (job_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_gen_chunks_job ON generation_chunks(job_id, seq);
CREATE INDEX IF NOT EXISTS idx_gen_chunks_status ON generation_chunks(job_id, status);

CREATE TABLE IF NOT EXISTS generation_context (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN ('global','outline','section','summary')),
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, context_type)
);

CREATE TABLE IF NOT EXISTS generation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  chunk_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT,
  detail TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gen_events_job ON generation_events(job_id, created_at);

CREATE TABLE IF NOT EXISTS generation_outputs (
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT,
  storage_ref TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','invalid')),
  validation_detail TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, version)
);
