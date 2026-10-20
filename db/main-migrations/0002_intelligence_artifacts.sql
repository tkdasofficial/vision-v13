-- Main vision D1 only. SQLite has no public schema or GRANT/RLS roles.
-- All reads/writes are scoped to the authenticated owner in intelligence-store.server.ts.
CREATE TABLE IF NOT EXISTS intelligence_artifacts (id TEXT NOT NULL, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT, artifact_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, root_id TEXT NOT NULL, parent_id TEXT, version INTEGER NOT NULL, operation TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,id));
CREATE INDEX IF NOT EXISTS idx_intelligence_chat ON intelligence_artifacts(user_id,chat_id,created_at);
CREATE INDEX IF NOT EXISTS idx_intelligence_versions ON intelligence_artifacts(user_id,root_id,version);