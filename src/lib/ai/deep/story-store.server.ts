import { d1 } from "@/lib/cloud/d1.server";
import type { StoryRun, StoryStore } from "./story-run";
/** Namespaced story records reuse the existing owner-scoped execution table. */
export function d1StoryStore(userId: string): StoryStore {
  return {
    async load(id) {
      const rows = await d1(
        "SELECT state FROM deep_executions WHERE user_id = ? AND request_id = ? LIMIT 1",
        [userId, `story:${id}`],
      );
      const row = rows[0] as { state?: string } | undefined;
      return row?.state ? (JSON.parse(row.state) as StoryRun) : null;
    },
    async save(run) {
      await d1(
        "INSERT INTO deep_executions (id,user_id,request_id,state,overall,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,request_id) DO UPDATE SET state=excluded.state,overall=excluded.overall,updated_at=excluded.updated_at WHERE excluded.updated_at >= deep_executions.updated_at",
        [
          `story:${userId}:${run.requestId}`,
          userId,
          `story:${run.requestId}`,
          JSON.stringify(run),
          run.status,
          run.updatedAt,
          run.updatedAt,
        ],
      );
    },
  };
}
