// Owner-scoped persistence for the vision-sandbox Long Context Generation store.
// All queries filter by user_id; JSON is validated at this boundary.
import { sandboxDb, type SandboxDb } from "./db.server";
import { checksum, type Plan } from "./generation";

export type JobStatus = "pending" | "planning" | "generating" | "validating" | "assembling" | "completed" | "failed" | "cancelled";
export type ChunkStatus = "pending" | "generating" | "validating" | "retrying" | "completed" | "failed" | "cancelled";
export type JobRow = { id: string; user_id: string; instructions: string; model_config: string; settings: string; status: JobStatus; total_chunks: number; completed_chunks: number; error: string | null; created_at: number; updated_at: number };
export type ChunkRow = { id: string; job_id: string; seq: number; section_id: string; title: string; instructions: string; content: string | null; status: ChunkStatus; attempts: number; tokens: number; checksum: string | null; error: string | null };

const id = () => crypto.randomUUID();
const now = () => Date.now();
const json = (v: unknown) => JSON.stringify(v ?? {});

async function event(db: SandboxDb, jobId: string, chunkId: string | null, type: string, status?: string, detail?: string, error?: string) {
  await db("INSERT INTO generation_events (job_id, chunk_id, event_type, status, detail, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [jobId, chunkId, type, status ?? null, detail ?? null, error ?? null, now()]);
}

/** Idempotent job creation: the same client request id returns the existing job. */
export async function createJob(userId: string, input: { instructions: string; modelConfig?: unknown; settings?: unknown; requestId?: string }, db: SandboxDb = sandboxDb): Promise<JobRow> {
  if (input.requestId) {
    const existing: JobRow[] = await db("SELECT * FROM generation_jobs WHERE user_id = ? AND id = ? LIMIT 1", [userId, input.requestId]);
    if (existing[0]) return existing[0];
  }
  const jobId = input.requestId ?? id();
  await db("INSERT OR IGNORE INTO generation_jobs (id, user_id, instructions, model_config, settings, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)", [jobId, userId, input.instructions, json(input.modelConfig), json(input.settings), now(), now()]);
  const rows: JobRow[] = await db("SELECT * FROM generation_jobs WHERE id = ? AND user_id = ? LIMIT 1", [jobId, userId]);
  if (!rows[0]) throw new Error("Generation job could not be created for this owner.");
  await event(db, jobId, null, "job_created", "pending");
  return rows[0];
}

export async function getJob(userId: string, jobId: string, db: SandboxDb = sandboxDb): Promise<JobRow | null> {
  return (await db("SELECT * FROM generation_jobs WHERE id = ? AND user_id = ? LIMIT 1", [jobId, userId]))[0] ?? null;
}

/** Compare-and-swap status transition; returns false when the job moved on. */
export async function setJobStatus(userId: string, jobId: string, from: JobStatus[] | null, to: JobStatus, patch: { error?: string | null; total_chunks?: number; completed_chunks?: number } = {}, db: SandboxDb = sandboxDb): Promise<boolean> {
  const sets = ["status = ?", "updated_at = ?"];
  const params: unknown[] = [to, now()];
  if (patch.error !== undefined) { sets.push("error = ?"); params.push(patch.error); }
  if (patch.total_chunks !== undefined) { sets.push("total_chunks = ?"); params.push(patch.total_chunks); }
  if (patch.completed_chunks !== undefined) { sets.push("completed_chunks = ?"); params.push(patch.completed_chunks); }
  const guard = from?.length ? ` AND status IN (${from.map(() => "?").join(",")})` : "";
  const res = await db(`UPDATE generation_jobs SET ${sets.join(", ")} WHERE id = ? AND user_id = ?${guard} RETURNING id`, [...params, jobId, userId, ...(from ?? [])]);
  const ok = res.length > 0;
  if (ok) await event(db, jobId, null, "job_status", to, patch.error ?? undefined);
  return ok;
}

/** Persists the plan and its chunk records before generation begins. Re-planning supersedes. */
export async function savePlan(userId: string, jobId: string, plan: Plan, db: SandboxDb = sandboxDb): Promise<void> {
  await db("UPDATE generation_plans SET status = 'superseded' WHERE job_id = ? AND status = 'active'", [jobId]);
  const v: any[] = await db("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM generation_plans WHERE job_id = ?", [jobId]);
  const version = v[0]?.v ?? 1;
  await db("INSERT INTO generation_plans (job_id, version, outline, chunk_structure, dependencies, context_policy, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
    [jobId, version, json(plan.outline), json(plan.chunks), json(Object.fromEntries(plan.chunks.map((c) => [c.seq, c.dependsOn]))), json(plan.contextPolicy), now()]);
  for (const c of plan.chunks) {
    await db("INSERT OR IGNORE INTO generation_chunks (id, job_id, seq, section_id, instructions, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      [id(), jobId, c.seq, c.sectionId, c.instructions, now(), now()]);
    await db("UPDATE generation_chunks SET section_id = ?, instructions = ?, updated_at = ? WHERE job_id = ? AND seq = ? AND status IN ('pending','failed','retrying')", [c.sectionId, c.instructions, now(), jobId, c.seq]);
  }
  await db("INSERT INTO generation_context (job_id, context_type, data, version, created_at, updated_at) VALUES (?, 'outline', ?, ?, ?, ?) ON CONFLICT(job_id, context_type) DO UPDATE SET data = excluded.data, version = generation_context.version + 1, updated_at = excluded.updated_at",
    [jobId, json({ outline: plan.outline, policy: plan.contextPolicy }), version, now(), now()]);
  await event(db, jobId, null, "plan_saved", "active", `version ${version}, ${plan.chunks.length} chunks`);
}

export async function loadPlan(userId: string, jobId: string, db: SandboxDb = sandboxDb): Promise<Plan | null> {
  const row: any = (await db("SELECT p.* FROM generation_plans p JOIN generation_jobs j ON j.id = p.job_id WHERE p.job_id = ? AND j.user_id = ? AND p.status = 'active' ORDER BY p.version DESC LIMIT 1", [jobId, userId]))[0];
  if (!row) return null;
  try {
    return { outline: JSON.parse(row.outline), chunks: JSON.parse(row.chunk_structure), contextPolicy: JSON.parse(row.context_policy) };
  } catch { return null; }
}

export async function listChunks(userId: string, jobId: string, db: SandboxDb = sandboxDb): Promise<ChunkRow[]> {
  return db("SELECT c.* FROM generation_chunks c JOIN generation_jobs j ON j.id = c.job_id WHERE c.job_id = ? AND j.user_id = ? ORDER BY c.seq", [jobId, userId]);
}

/** Claims a chunk for one generation attempt; false when already running/done. */
export async function claimChunk(userId: string, jobId: string, seq: number, db: SandboxDb = sandboxDb): Promise<ChunkRow | null> {
  const rows: ChunkRow[] = await db(
    "UPDATE generation_chunks SET status = 'generating', attempts = attempts + 1, updated_at = ? WHERE job_id = ? AND seq = ? AND status IN ('pending','failed','retrying') AND job_id IN (SELECT id FROM generation_jobs WHERE user_id = ?) RETURNING *",
    [now(), jobId, seq, userId],
  );
  if (rows[0]) await event(db, jobId, rows[0].id, "chunk_started", rows[0].status, `attempt ${rows[0].attempts}`);
  return rows[0] ?? null;
}

/** Saves a chunk result only while the chunk is still in-flight (no duplicate results on retry races). */
export async function completeChunk(userId: string, jobId: string, seq: number, content: string, tokens: number, db: SandboxDb = sandboxDb): Promise<boolean> {
  const rows: ChunkRow[] = await db(
    "UPDATE generation_chunks SET content = ?, status = 'completed', tokens = ?, checksum = ?, error = NULL, updated_at = ? WHERE job_id = ? AND seq = ? AND status IN ('generating','validating','retrying') AND job_id IN (SELECT id FROM generation_jobs WHERE user_id = ?) RETURNING id",
    [content, tokens, checksum(content), now(), jobId, seq, userId],
  );
  if (!rows[0]) return false;
  await event(db, jobId, rows[0].id, "chunk_completed", "completed", `${tokens} tokens`);
  await db("UPDATE generation_jobs SET completed_chunks = (SELECT COUNT(*) FROM generation_chunks WHERE job_id = ? AND status = 'completed'), updated_at = ? WHERE id = ?", [jobId, now(), jobId]);
  return true;
}

export async function failChunk(userId: string, jobId: string, seq: number, error: string, db: SandboxDb = sandboxDb): Promise<void> {
  const rows: ChunkRow[] = await db(
    "UPDATE generation_chunks SET status = 'failed', error = ?, updated_at = ? WHERE job_id = ? AND seq = ? AND status IN ('generating','validating','retrying','pending') AND job_id IN (SELECT id FROM generation_jobs WHERE user_id = ?) RETURNING id",
    [error.slice(0, 300), now(), jobId, seq, userId],
  );
  if (rows[0]) await event(db, jobId, rows[0].id, "chunk_failed", "failed", undefined, error.slice(0, 300));
}

export async function saveOutput(userId: string, jobId: string, content: string, valid: boolean, detail?: string, db: SandboxDb = sandboxDb): Promise<number> {
  const v: any[] = await db("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM generation_outputs WHERE job_id = ?", [jobId]);
  const version = v[0]?.v ?? 1;
  await db("INSERT INTO generation_outputs (job_id, version, content, storage_ref, validation_status, validation_detail, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)",
    [jobId, version, content, valid ? "valid" : "invalid", detail ?? null, now()]);
  await event(db, jobId, null, "output_saved", valid ? "valid" : "invalid", detail);
  return version;
}

export async function latestOutput(userId: string, jobId: string, db: SandboxDb = sandboxDb) {
  return (await db("SELECT o.* FROM generation_outputs o JOIN generation_jobs j ON j.id = o.job_id WHERE o.job_id = ? AND j.user_id = ? ORDER BY o.version DESC LIMIT 1", [jobId, userId]))[0] ?? null;
}

export async function listEvents(userId: string, jobId: string, db: SandboxDb = sandboxDb) {
  return db("SELECT e.id, e.chunk_id, e.event_type, e.status, e.detail, e.error, e.created_at FROM generation_events e JOIN generation_jobs j ON j.id = e.job_id WHERE e.job_id = ? AND j.user_id = ? ORDER BY e.created_at, e.id LIMIT 200", [jobId, userId]);
}

/** Failed or stale in-flight chunks become retryable; completed work is untouched. */
export async function markRetryable(userId: string, jobId: string, db: SandboxDb = sandboxDb, seq?: number): Promise<void> {
  // In-run retries may reset only their own failed chunk, never another active worker.
  const states = seq === undefined ? "'failed','generating','validating'" : "'failed'";
  const guard = seq === undefined ? "" : " AND seq = ?";
  await db(`UPDATE generation_chunks SET status = 'retrying', updated_at = ? WHERE job_id = ? AND status IN (${states}) AND job_id IN (SELECT id FROM generation_jobs WHERE user_id = ?)${guard}`, [now(), jobId, userId, ...(seq === undefined ? [] : [seq])]);
}
