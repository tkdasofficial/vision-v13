// D1 record of each chat generation (owner-scoped): live stage, history and final outcome, so a reload
// can reconnect to the running work instead of starting a duplicate request. Server-only.
import { appendStage, HEARTBEAT_MS, viewGeneration, type GenerationRow, type GenerationView } from "./generation-state";
import type { TaskStage } from "./task-events";

type Db = (sql: string, params?: unknown[]) => Promise<any[]>;
const defaultDb: Db = async (sql, params) => (await import("@/lib/cloud/d1.server")).d1(sql, params ?? []);

let ready: Promise<unknown> | null = null;
const ensure = (db: Db) => (ready ??= db("CREATE TABLE IF NOT EXISTS chat_generations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, chat_id TEXT, status TEXT NOT NULL, stage TEXT, detail TEXT, history TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
  .then(() => db("CREATE INDEX IF NOT EXISTS idx_chat_generations_chat ON chat_generations(user_id, chat_id, created_at)"))
  .catch((e) => { ready = null; throw e; }));

export type GenerationTracker = { stage(stage: TaskStage, detail?: string): void; finish(status: "completed" | "failed" | "cancelled", error?: string): Promise<void> };

/**
 * Starts tracking a generation. Writes are serialized and never throw into the chat pipeline:
 * a storage failure only loses the live status, never the answer.
 */
export function trackGeneration(userId: string, chatId: string | undefined, id: string, db: Db = defaultDb, now = () => Date.now()): GenerationTracker {
  let history: TaskStage[] = [];
  let last: { stage: TaskStage | null; detail?: string } = { stage: null };
  let done = false;
  let chain: Promise<unknown> = ensure(db).then(() => db(
    "INSERT OR IGNORE INTO chat_generations (id, user_id, chat_id, status, stage, detail, history, error, created_at, updated_at) VALUES (?, ?, ?, 'running', NULL, NULL, '[]', NULL, ?, ?)",
    [id, userId, chatId ?? null, now(), now()],
  )).catch((e) => console.error("[chat:generation] start", (e as Error)?.message));
  const write = (sql: string, params: unknown[]) => { chain = chain.then(() => db(sql, params)).catch((e) => console.error("[chat:generation] write", (e as Error)?.message)); return chain; };
  const persist = () => write("UPDATE chat_generations SET stage = ?, detail = ?, history = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'running'", [last.stage, last.detail ?? null, JSON.stringify(history), now(), id, userId]);
  const beat = setInterval(() => { if (!done) persist(); }, HEARTBEAT_MS);
  return {
    stage(stage, detail) {
      if (done || stage === "switching_provider" || stage === "failed" || stage === "cancelled") return;
      history = appendStage(history, stage);
      last = { stage, detail: detail?.slice(0, 160) };
      persist();
    },
    async finish(status, error) {
      if (done) return;
      done = true; clearInterval(beat);
      await write("UPDATE chat_generations SET status = ?, error = ?, history = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'running'", [status, error?.slice(0, 300) ?? null, JSON.stringify(history), now(), id, userId]);
    },
  };
}

/** Latest generation for a chat the caller owns (or one by id). */
export async function latestGeneration(userId: string, q: { chatId?: string; id?: string }, db: Db = defaultDb): Promise<GenerationView | null> {
  await ensure(db);
  const rows: GenerationRow[] = q.id
    ? await db("SELECT * FROM chat_generations WHERE id = ? AND user_id = ? LIMIT 1", [q.id, userId])
    : await db("SELECT * FROM chat_generations WHERE chat_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1", [q.chatId, userId]);
  if (Math.random() < 0.02) db("DELETE FROM chat_generations WHERE updated_at < ?", [Date.now() - 7 * 86400_000]).catch(() => {});
  return rows[0] ? viewGeneration(rows[0]) : null;
}
