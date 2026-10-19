// D1 persistence for Deep Thinking executions (owner-scoped). Server-only.
import { d1 } from "@/lib/cloud/d1.server";
import { compactState, type ExecutionState, type StateStore } from "./engine";

let ready: Promise<unknown> | null = null;
const ensure = () => (ready ??= d1("CREATE TABLE IF NOT EXISTS deep_executions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT NOT NULL, conversation_id TEXT, state TEXT NOT NULL, overall TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, request_id))").catch((e) => { ready = null; throw e; }));

export function d1ExecutionStore(userId: string): StateStore {
  return {
    async load(requestId) {
      await ensure();
      const row: any = (await d1("SELECT state FROM deep_executions WHERE user_id = ? AND request_id = ? LIMIT 1", [userId, requestId]))[0];
      return row ? (JSON.parse(row.state) as ExecutionState) : null;
    },
    async save(s) {
      await ensure();
      await d1(
        "INSERT INTO deep_executions (id, user_id, request_id, conversation_id, state, overall, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, request_id) DO UPDATE SET state = excluded.state, overall = excluded.overall, updated_at = excluded.updated_at WHERE excluded.updated_at >= deep_executions.updated_at",
        [s.executionId, userId, s.requestId, s.conversationId ?? null, JSON.stringify(compactState(s)), s.overall, s.createdAt, s.updatedAt],
      );
      if (Math.random() < 0.02) await d1("DELETE FROM deep_executions WHERE updated_at < ?", [Date.now() - 7 * 86400_000]).catch(() => {});
    },
  };
}
