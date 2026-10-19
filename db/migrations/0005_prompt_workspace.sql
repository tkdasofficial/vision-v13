-- vision-sandbox: per-job prompt-generation workspace (additive; no drops or renames).
-- Reuses: generation_jobs (extended below; id = job_id) and generation_events (= job_events).
-- Rollback: db/rollback/0005_prompt_workspace.down.sql
-- Apply with: npx wrangler d1 migrations apply vision-sandbox --remote

-- Table 1: generation_jobs (reused). Existing `status` keeps serving the Long Context runner;
-- the prompt workflow state lives in `workflow_status`.
ALTER TABLE generation_jobs ADD COLUMN chat_id TEXT;
ALTER TABLE generation_jobs ADD COLUMN workflow_status TEXT CHECK (workflow_status IS NULL OR workflow_status IN ('queued','initializing','generating','validating','repairing','final_validating','delivering','succeeded','failed','cancelled','expired'));
ALTER TABLE generation_jobs ADD COLUMN requested_prompt_count INTEGER CHECK (requested_prompt_count IS NULL OR requested_prompt_count >= 0);
ALTER TABLE generation_jobs ADD COLUMN current_slot_index INTEGER;
ALTER TABLE generation_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generation_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE generation_jobs ADD COLUMN queued_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN started_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN completed_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN deadline_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN last_heartbeat_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN last_error_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gen_jobs_idem ON generation_jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gen_jobs_user_wf ON generation_jobs(user_id, workflow_status);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_chat ON generation_jobs(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_deadline ON generation_jobs(deadline_at, last_heartbeat_at);

-- Table 2
CREATE TABLE IF NOT EXISTS generation_requests (
  request_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  chat_id TEXT,
  message_id TEXT,
  source_page TEXT,
  original_request TEXT NOT NULL,
  requested_at INTEGER NOT NULL
);

-- Table 3
CREATE TABLE IF NOT EXISTS request_context (
  context_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id) ON DELETE CASCADE,
  task_type TEXT CHECK (task_type IS NULL OR task_type IN ('story_prompts','advertisement_prompts','image_prompts','video_prompts','general_prompts')),
  topic TEXT, purpose TEXT, target_audience TEXT, language TEXT, tone TEXT, style TEXT, output_format TEXT,
  requested_prompt_count INTEGER,
  reference_material TEXT,
  normalized_request TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending','extracted','partial','failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Table 4
CREATE TABLE IF NOT EXISTS request_constraints (
  constraint_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  constraint_type TEXT NOT NULL CHECK (constraint_type IN ('required_element','forbidden_element','reference_requirement','consistency_rule','continuity_rule','other')),
  constraint_value TEXT NOT NULL,
  is_mandatory INTEGER NOT NULL DEFAULT 1 CHECK (is_mandatory IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_constraints_job ON request_constraints(job_id);

-- Table 5
CREATE TABLE IF NOT EXISTS job_slots (
  slot_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 1),
  slot_type TEXT NOT NULL CHECK (slot_type IN ('original_request','request_metadata','blueprint','generated_prompt')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reserved','generating','validating','repairing','completed','failed','unused','expired')),
  allocated_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  released_at INTEGER,
  expires_at INTEGER,
  UNIQUE (job_id, slot_index)
);
CREATE INDEX IF NOT EXISTS idx_job_slots_job ON job_slots(job_id, slot_index);
CREATE INDEX IF NOT EXISTS idx_job_slots_user ON job_slots(user_id, status);

-- Table 6
CREATE TABLE IF NOT EXISTS prompt_versions (
  version_id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES job_slots(slot_id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  prompt_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  UNIQUE (slot_id, version_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_versions_current ON prompt_versions(slot_id) WHERE is_current = 1;

-- Table 7
CREATE TABLE IF NOT EXISTS generation_attempts (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES job_slots(slot_id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('generation','repair','retry','validation')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','cancelled')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  error_code TEXT,
  error_summary TEXT,
  UNIQUE (job_id, slot_id, attempt_type, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_attempts_job ON generation_attempts(job_id, slot_id, attempt_number);

-- Table 8
CREATE TABLE IF NOT EXISTS validation_runs (
  validation_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL REFERENCES job_slots(slot_id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES prompt_versions(version_id) ON DELETE CASCADE,
  consistency_score REAL CHECK (consistency_score IS NULL OR (consistency_score >= 0 AND consistency_score <= 100)),
  continuity_score REAL CHECK (continuity_score IS NULL OR (continuity_score >= 0 AND continuity_score <= 100)),
  overall_status TEXT NOT NULL CHECK (overall_status IN ('passed','failed','not_measurable','error')),
  validation_summary TEXT,
  validated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_validation_slot ON validation_runs(slot_id, version_id);

-- Table 9
CREATE TABLE IF NOT EXISTS validation_findings (
  finding_id TEXT PRIMARY KEY,
  validation_id TEXT NOT NULL REFERENCES validation_runs(validation_id) ON DELETE CASCADE,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  required_fix TEXT,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_findings_validation ON validation_findings(validation_id);

-- Table 10: job_events = existing generation_events (event_id=id, event_status=status, event_at=created_at, details=detail).

-- Table 11
CREATE TABLE IF NOT EXISTS job_timing_metrics (
  metric_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES job_slots(slot_id) ON DELETE CASCADE,
  queue_wait_ms INTEGER CHECK (queue_wait_ms IS NULL OR queue_wait_ms >= 0),
  generation_ms INTEGER CHECK (generation_ms IS NULL OR generation_ms >= 0),
  validation_ms INTEGER CHECK (validation_ms IS NULL OR validation_ms >= 0),
  repair_ms INTEGER CHECK (repair_ms IS NULL OR repair_ms >= 0),
  total_work_ms INTEGER CHECK (total_work_ms IS NULL OR total_work_ms >= 0),
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timing_job ON job_timing_metrics(job_id, recorded_at);

-- Table 12
CREATE TABLE IF NOT EXISTS cleanup_tasks (
  cleanup_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK (cleanup_status IN ('pending','running','completed','failed')),
  scheduled_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_cleanup_pending ON cleanup_tasks(cleanup_status, scheduled_at);
