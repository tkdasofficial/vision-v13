-- Manual rollback for 0005 (not auto-applied; drops only tables 0005 created).
DROP TABLE IF EXISTS validation_findings;
DROP TABLE IF EXISTS validation_runs;
DROP TABLE IF EXISTS generation_attempts;
DROP TABLE IF EXISTS job_timing_metrics;
DROP TABLE IF EXISTS prompt_versions;
DROP TABLE IF EXISTS job_slots;
DROP TABLE IF EXISTS request_constraints;
DROP TABLE IF EXISTS request_context;
DROP TABLE IF EXISTS generation_requests;
DROP TABLE IF EXISTS cleanup_tasks;
DROP INDEX IF EXISTS uq_gen_jobs_idem;
DROP INDEX IF EXISTS idx_gen_jobs_user_wf;
DROP INDEX IF EXISTS idx_gen_jobs_chat;
DROP INDEX IF EXISTS idx_gen_jobs_deadline;
-- Added generation_jobs columns are left in place (nullable, unused by older code).
