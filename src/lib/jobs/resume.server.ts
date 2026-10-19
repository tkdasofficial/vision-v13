// Resume plumbing for agent tasks: atomic one-time claim of an interrupted job's checkpoint, owner-checked
// reload + SHA-256 integrity check of finished outputs, and checkpoint writes that a superseded worker can't make.
import { d1 } from "@/lib/cloud/d1.server";
import { TOOL_MAP, type WorkFile } from "@/lib/tools/registry.server";
import { serialize, validateCheckpoint } from "./checkpoint";
import { CancelledError, ID_RE, type JobRun } from "./jobs.server";
import type { AgentResume } from "./agent.server";

/** Thrown when another worker already took over this job; the stale worker must stop writing. */
export class SupersededError extends Error { constructor() { super("This task was continued elsewhere."); } }

/**
 * Claims the previous job exactly once (UPDATE … WHERE resumed_by IS NULL), so two retries can never both
 * continue it. Returns null (fresh run) when the checkpoint is missing, invalid, expired or its files are gone.
 */
export async function claimResume(job: JobRun, prevId: string, db = d1, loadBytes?: (driveId: string) => Promise<Uint8Array>): Promise<AgentResume | null> {
  if (!ID_RE.test(prevId) || prevId === job.id) return null;
  const rows = await db<{ checkpoint: string | null }>(
    "UPDATE jobs SET resumed_by = ? WHERE id = ? AND user_id = ? AND type = 'agent_task' AND resumed_by IS NULL AND status IN ('failed','cancelled','timed_out') RETURNING checkpoint",
    [job.id, prevId, job.userId]);
  if (!rows[0]) throw new Error("This task is already being continued, or can't be continued.");
  const check = validateCheckpoint(rows[0].checkpoint, { owner: job.userId, jobId: prevId, knownTool: (id) => TOOL_MAP.has(id) });
  if (!check.ok) {
    if (rows[0].checkpoint) job.warn(`Earlier progress couldn't be reused (${check.reason}); the task restarted from the beginning.`);
    return null;
  }
  const ids = check.cp.done.flatMap((d) => d.artifactIds);
  const outputs: WorkFile[] = [];
  if (ids.length) {
    const arts = await db<any>(`SELECT id, name, mime, sha256, drive_file_id, expires_at FROM job_artifacts WHERE user_id = ? AND job_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [job.userId, prevId, ...ids]);
    const byId = new Map(arts.map((a) => [a.id, a]));
    const load = loadBytes ?? (await import("./artifact-store.server")).getArtifactBytes;
    for (const id of ids) {
      const a = byId.get(id);
      if (!a || Date.parse(a.expires_at) <= Date.now()) { job.warn("Files from the earlier attempt expired; the task restarted from the beginning."); return null; }
      const bytes = await load(a.drive_file_id);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hash !== a.sha256) { job.warn("Files from the earlier attempt failed an integrity check; the task restarted from the beginning."); return null; }
      outputs.unshift({ name: a.name, mime: a.mime, bytes });
    }
  }
  return { cp: check.cp, outputs };
}

/** Writes a checkpoint only while this job is still the live owner of its work. */
export async function persistCheckpoint(userId: string, jobId: string, cp: unknown, db = d1) {
  const r = await db("UPDATE jobs SET checkpoint = ? WHERE id = ? AND user_id = ? AND resumed_by IS NULL RETURNING id", [serialize(cp as any), jobId, userId]);
  if (!r[0]) throw new SupersededError();
}

export { CancelledError };
