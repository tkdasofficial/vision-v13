-- MAIN vision D1 only, never vision-sandbox. Existing rows and chat history are preserved.
ALTER TABLE user_memories ADD COLUMN category TEXT NOT NULL DEFAULT 'context';
ALTER TABLE user_memories ADD COLUMN source_ref TEXT;
ALTER TABLE user_memories ADD COLUMN canonical_key TEXT;
ALTER TABLE user_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_canonical ON user_memories(user_id, canonical_key);
CREATE TABLE IF NOT EXISTS user_memory_state (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, history_blocked INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS memory_delete_privacy AFTER DELETE ON user_memories BEGIN
  INSERT INTO user_memory_state(user_id, revision, history_blocked) VALUES (OLD.user_id, 1, CAST(strftime('%s','now') AS INTEGER)*1000)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1, history_blocked = excluded.history_blocked;
END;
CREATE TRIGGER IF NOT EXISTS memory_prefs_revision AFTER UPDATE OF prefs ON user_settings BEGIN
  INSERT INTO user_memory_state(user_id, revision) VALUES (NEW.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
END;