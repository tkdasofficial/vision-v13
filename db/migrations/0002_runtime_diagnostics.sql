-- Rejected private candidates are never successful results or artifacts.
CREATE TABLE IF NOT EXISTS runtime_diagnostics (
 job_id TEXT NOT NULL, user_id TEXT NOT NULL, id TEXT NOT NULL,
 stage TEXT NOT NULL, evidence TEXT NOT NULL, sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 256000),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(job_id,id)
);
CREATE INDEX IF NOT EXISTS runtime_diagnostics_owner ON runtime_diagnostics(user_id,job_id,expires_at);
CREATE INDEX IF NOT EXISTS runtime_diagnostics_expiry ON runtime_diagnostics(expires_at);