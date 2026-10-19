// Per-job prompt-generation workspace in vision-sandbox (migration 0005). Store-agnostic: every
// function takes a Db so it runs on the D1 binding, D1 REST, or SQLite in tests. Every call is
// scoped by the server-derived userId; nothing here trusts a client-supplied owner.
export type Db = (sql: string, params?: unknown[]) => Promise<any[]>;

export const WORKSPACE_CONFIG = {
  basePromptSlots: 25,
  maxPromptSlots: 500,
  passThreshold: 90,
  retentionMs: 24 * 3600_000,
  failedRetentionMs: 3 * 86400_000,
  heartbeatStaleMs: 10 * 60_000,
};

export type WorkflowStatus = "queued" | "initializing" | "generating" | "validating" | "repairing" | "final_validating" | "delivering" | "succeeded" | "failed" | "cancelled" | "expired";
export type SlotType = "original_request" | "request_metadata" | "blueprint" | "generated_prompt";

const TERMINAL: WorkflowStatus[] = ["succeeded", "failed", "cancelled", "expired"];
const END = ["failed", "cancelled", "expired"] as const;
export const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  queued: ["initializing", ...END],
  initializing: ["generating", ...END],
  generating: ["validating", ...END],
  validating: ["repairing", "generating", "final_validating", ...END],
  repairing: ["validating", ...END],
  final_validating: ["delivering", "repairing", ...END],
  delivering: ["succeeded", ...END],
  succeeded: [], failed: [], cancelled: [], expired: [],
};

const uid = () => crypto.randomUUID();

/** Slots 1-3 are fixed; prompts start at 4. At least 25 prompt slots; more only when requested. */
export function slotLayout(requested: number, base = WORKSPACE_CONFIG.basePromptSlots): { index: number; type: SlotType; used: boolean }[] {
  const n = Math.max(0, Math.floor(requested));
  if (n > WORKSPACE_CONFIG.maxPromptSlots) throw new Error(`At most ${WORKSPACE_CONFIG.maxPromptSlots} prompts per job.`);
  const fixed: SlotType[] = ["original_request", "request_metadata", "blueprint"];
  const out = fixed.map((type, i) => ({ index: i + 1, type, used: true }));
  for (let i = 0; i < Math.max(base, n); i++) out.push({ index: 4 + i, type: "generated_prompt", used: i < n });
  return out;
}

/** Validation passes only if BOTH scores reach the threshold; a missing score is never invented. */
export function judge(consistency: number | null, continuity: number | null, threshold = WORKSPACE_CONFIG.passThreshold) {
  if (consistency == null || continuity == null) return "not_measurable" as const;
  return consistency >= threshold && continuity >= threshold ? ("passed" as const) : ("failed" as const);
}

async function event(db: Db, jobId: string, type: string, status?: string, detail?: string) {
  await db("INSERT INTO generation_events (job_id, event_type, status, detail, created_at) VALUES (?, ?, ?, ?, ?)", [jobId, type, status ?? null, detail?.slice(0, 500) ?? null, Date.now()]);
}

async function ownedJob(db: Db, userId: string, jobId: string) {
  const row = (await db("SELECT * FROM generation_jobs WHERE id = ? AND user_id = ? LIMIT 1", [jobId, userId]))[0];
  if (!row) throw new Error("Job not found.");
  return row;
}

async function ownedSlot(db: Db, userId: string, slotId: string) {
  const row = (await db("SELECT s.* FROM job_slots s JOIN generation_jobs j ON j.id = s.job_id WHERE s.slot_id = ? AND s.user_id = ? AND j.user_id = ? LIMIT 1", [slotId, userId, userId]))[0];
  if (!row) throw new Error("Slot not found.");
  return row;
}

export type InitInput = {
  chatId: string; originalRequest: string; requestedPromptCount: number; idempotencyKey: string;
  messageId?: string; sourcePage?: string; priority?: number; deadlineMs?: number;
  /** Caller proves chat ownership via the existing chat store before any write. */
  ownsChat: (chatId: string) => Promise<boolean>;
};

/** Idempotent: the same (user, idempotencyKey) always returns the same job and never re-allocates. */
export async function initJob(db: Db, userId: string, input: InitInput) {
  if (!(await input.ownsChat(input.chatId))) throw new Error("Chat not found.");
  const layout = slotLayout(input.requestedPromptCount);
  const existing = (await db("SELECT id FROM generation_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1", [userId, input.idempotencyKey]))[0];
  const jobId: string = existing?.id ?? uid();
  const t = Date.now();
  if (!existing) {
    await db(
      "INSERT OR IGNORE INTO generation_jobs (id, user_id, instructions, status, workflow_status, chat_id, requested_prompt_count, current_slot_index, priority, idempotency_key, created_at, queued_at, updated_at, deadline_at) VALUES (?, ?, ?, 'pending', 'queued', ?, ?, 1, ?, ?, ?, ?, ?, ?)",
      [jobId, userId, input.originalRequest, input.chatId, input.requestedPromptCount, input.priority ?? 0, input.idempotencyKey, t, t, t, input.deadlineMs ? t + input.deadlineMs : null],
    );
  }
  const job = (await db("SELECT * FROM generation_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1", [userId, input.idempotencyKey]))[0];
  if (!job) throw new Error("Job could not be created.");
  await db("INSERT OR IGNORE INTO generation_requests (request_id, job_id, user_id, chat_id, message_id, source_page, original_request, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [uid(), job.id, userId, input.chatId, input.messageId ?? null, input.sourcePage ?? null, input.originalRequest, t]);
  await allocate(db, userId, job.id, layout);
  if (!existing) await event(db, job.id, "job_created", "queued", `slots=${layout.length}`);
  return { job, slots: await listSlots(db, userId, job.id) };
}

async function allocate(db: Db, userId: string, jobId: string, layout: ReturnType<typeof slotLayout>) {
  const t = Date.now();
  for (const s of layout) {
    await db("INSERT OR IGNORE INTO job_slots (slot_id, job_id, user_id, slot_index, slot_type, status, allocated_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [uid(), jobId, userId, s.index, s.type, s.used ? "pending" : "unused", t, t]);
  }
}

/** Grows a job's prompt slots when more prompts are requested; existing slots are untouched. */
export async function expandPrompts(db: Db, userId: string, jobId: string, count: number) {
  const job = await ownedJob(db, userId, jobId);
  if (TERMINAL.includes(job.workflow_status)) throw new Error("Job is finished.");
  await allocate(db, userId, jobId, slotLayout(count));
  await db("UPDATE job_slots SET status = 'pending', updated_at = ? WHERE job_id = ? AND user_id = ? AND status = 'unused' AND slot_type = 'generated_prompt' AND slot_index <= ?", [Date.now(), jobId, userId, 3 + count]);
  await db("UPDATE generation_jobs SET requested_prompt_count = ?, updated_at = ? WHERE id = ? AND user_id = ?", [count, Date.now(), jobId, userId]);
  await event(db, jobId, "slots_expanded", undefined, `prompts=${count}`);
  return listSlots(db, userId, jobId);
}

export async function listSlots(db: Db, userId: string, jobId: string) {
  return db("SELECT * FROM job_slots WHERE job_id = ? AND user_id = ? ORDER BY slot_index", [jobId, userId]);
}

/** Compare-and-swap on the allowed transition table; false when the job already moved on. */
export async function transition(db: Db, userId: string, jobId: string, to: WorkflowStatus, errorCode?: string): Promise<boolean> {
  const job = await ownedJob(db, userId, jobId);
  const from = job.workflow_status as WorkflowStatus;
  if (!TRANSITIONS[from]?.includes(to)) return false;
  const t = Date.now();
  const rows = await db(
    `UPDATE generation_jobs SET workflow_status = ?, updated_at = ?, last_heartbeat_at = ?, started_at = COALESCE(started_at, ?), completed_at = ?, last_error_code = COALESCE(?, last_error_code) WHERE id = ? AND user_id = ? AND workflow_status = ? RETURNING id`,
    [to, t, t, from === "queued" ? t : null, TERMINAL.includes(to) ? t : null, errorCode ?? null, jobId, userId, from],
  );
  if (!rows.length) return false;
  await event(db, jobId, "status_changed", to, `${from}->${to}`);
  if (to === "failed" || to === "cancelled" || to === "expired") await scheduleCleanup(db, userId, jobId, WORKSPACE_CONFIG.failedRetentionMs);
  return true;
}

export async function heartbeat(db: Db, userId: string, jobId: string) {
  await db("UPDATE generation_jobs SET last_heartbeat_at = ? WHERE id = ? AND user_id = ?", [Date.now(), jobId, userId]);
}

/** Stores a complete replacement version (never a fragment) and makes it current. */
export async function saveVersion(db: Db, userId: string, slotId: string, content: string) {
  const slot = await ownedSlot(db, userId, slotId);
  const next = ((await db("SELECT MAX(version_number) AS v FROM prompt_versions WHERE slot_id = ?", [slotId]))[0]?.v ?? 0) + 1;
  const versionId = uid();
  await db("UPDATE prompt_versions SET is_current = 0 WHERE slot_id = ? AND is_current = 1", [slotId]);
  await db("INSERT INTO prompt_versions (version_id, slot_id, version_number, prompt_content, created_at, is_current) VALUES (?, ?, ?, ?, ?, 1)", [versionId, slotId, next, content, Date.now()]);
  await db("UPDATE generation_jobs SET current_slot_index = ?, updated_at = ? WHERE id = ? AND user_id = ?", [slot.slot_index, Date.now(), slot.job_id, userId]);
  return { versionId, versionNumber: next };
}

export async function setSlotStatus(db: Db, userId: string, slotId: string, status: string) {
  await ownedSlot(db, userId, slotId);
  const t = Date.now();
  await db("UPDATE job_slots SET status = ?, updated_at = ?, started_at = COALESCE(started_at, CASE WHEN ? = 'generating' THEN ? END) WHERE slot_id = ? AND user_id = ?", [status, t, status, t, slotId, userId]);
}

export async function startAttempt(db: Db, userId: string, slotId: string, type: "generation" | "repair" | "retry" | "validation") {
  const slot = await ownedSlot(db, userId, slotId);
  const n = ((await db("SELECT MAX(attempt_number) AS n FROM generation_attempts WHERE slot_id = ? AND attempt_type = ?", [slotId, type]))[0]?.n ?? 0) + 1;
  const attemptId = uid();
  await db("INSERT INTO generation_attempts (attempt_id, job_id, slot_id, attempt_type, attempt_number, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)", [attemptId, slot.job_id, slotId, type, n, Date.now()]);
  return { attemptId, attemptNumber: n };
}

export async function endAttempt(db: Db, userId: string, attemptId: string, status: "succeeded" | "failed" | "cancelled", error?: { code: string; summary?: string }) {
  await db(
    "UPDATE generation_attempts SET status = ?, ended_at = ?, error_code = ?, error_summary = ? WHERE attempt_id = ? AND status = 'running' AND job_id IN (SELECT id FROM generation_jobs WHERE user_id = ?)",
    [status, Date.now(), error?.code ?? null, error?.summary?.slice(0, 300) ?? null, attemptId, userId],
  );
}

export type Finding = { issueType: string; severity: "low" | "medium" | "high" | "critical"; description: string; requiredFix?: string };

export async function recordValidation(db: Db, userId: string, versionId: string, r: { consistency: number | null; continuity: number | null; summary?: string; findings?: Finding[] }, threshold = WORKSPACE_CONFIG.passThreshold) {
  const v = (await db("SELECT v.version_id, s.slot_id, s.job_id FROM prompt_versions v JOIN job_slots s ON s.slot_id = v.slot_id WHERE v.version_id = ? AND s.user_id = ? LIMIT 1", [versionId, userId]))[0];
  if (!v) throw new Error("Version not found.");
  const status = judge(r.consistency, r.continuity, threshold);
  const validationId = uid();
  await db("INSERT INTO validation_runs (validation_id, job_id, slot_id, version_id, consistency_score, continuity_score, overall_status, validation_summary, validated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [validationId, v.job_id, v.slot_id, versionId, r.consistency, r.continuity, status, r.summary ?? null, Date.now()]);
  for (const f of r.findings ?? []) {
    await db("INSERT INTO validation_findings (finding_id, validation_id, issue_type, severity, description, required_fix) VALUES (?, ?, ?, ?, ?, ?)", [uid(), validationId, f.issueType, f.severity, f.description, f.requiredFix ?? null]);
  }
  return { validationId, status };
}

export async function recordTiming(db: Db, userId: string, jobId: string, m: { slotId?: string; queueWaitMs?: number; generationMs?: number; validationMs?: number; repairMs?: number }) {
  await ownedJob(db, userId, jobId);
  const work = (m.generationMs ?? 0) + (m.validationMs ?? 0) + (m.repairMs ?? 0);
  await db("INSERT INTO job_timing_metrics (metric_id, job_id, slot_id, queue_wait_ms, generation_ms, validation_ms, repair_ms, total_work_ms, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [uid(), jobId, m.slotId ?? null, m.queueWaitMs ?? null, m.generationMs ?? null, m.validationMs ?? null, m.repairMs ?? null, work, Date.now()]);
}

/** Call only after the result is durably saved in chat history. Idempotent per job. */
export async function scheduleCleanup(db: Db, userId: string, jobId: string, afterMs = WORKSPACE_CONFIG.retentionMs) {
  await ownedJob(db, userId, jobId);
  await db("INSERT OR IGNORE INTO cleanup_tasks (cleanup_id, job_id, user_id, cleanup_status, scheduled_at) VALUES (?, ?, ?, 'pending', ?)", [uid(), jobId, userId, Date.now() + afterMs]);
}

/** Marks running jobs past their deadline or with a stale heartbeat as expired (schedules cleanup). */
export async function expireStalled(db: Db, now = Date.now()) {
  const rows = await db(
    "SELECT id, user_id FROM generation_jobs WHERE workflow_status IN ('queued','initializing','generating','validating','repairing','final_validating','delivering') AND ((deadline_at IS NOT NULL AND deadline_at < ?) OR (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < ?)) LIMIT 50",
    [now, now - WORKSPACE_CONFIG.heartbeatStaleMs],
  );
  let n = 0;
  for (const r of rows) if (await transition(db, r.user_id, r.id, "expired", "stalled")) n++;
  return n;
}

const WORKSPACE_TABLES = ["validation_findings", "validation_runs", "generation_attempts", "job_timing_metrics", "prompt_versions", "job_slots", "request_constraints", "request_context", "generation_requests"];

/** Deletes due workspaces job-by-job. Touches only vision-sandbox rows of that exact job — never chat history. */
export async function runCleanup(db: Db, now = Date.now(), limit = 20) {
  const due = await db("SELECT cleanup_id, job_id, user_id, retry_count FROM cleanup_tasks WHERE cleanup_status IN ('pending','failed') AND scheduled_at <= ? AND retry_count < 5 ORDER BY scheduled_at LIMIT ?", [now, limit]);
  let done = 0;
  for (const task of due) {
    const claimed = await db("UPDATE cleanup_tasks SET cleanup_status = 'running', started_at = ? WHERE cleanup_id = ? AND cleanup_status IN ('pending','failed') RETURNING cleanup_id", [now, task.cleanup_id]);
    if (!claimed.length) continue;
    try {
      const job = (await db("SELECT id FROM generation_jobs WHERE id = ? AND user_id = ?", [task.job_id, task.user_id]))[0];
      if (job) {
        await db("DELETE FROM validation_findings WHERE validation_id IN (SELECT validation_id FROM validation_runs WHERE job_id = ?)", [job.id]);
        await db("DELETE FROM prompt_versions WHERE slot_id IN (SELECT slot_id FROM job_slots WHERE job_id = ?)", [job.id]);
        for (const t of WORKSPACE_TABLES.filter((t) => t !== "validation_findings" && t !== "prompt_versions")) await db(`DELETE FROM ${t} WHERE job_id = ?`, [job.id]);
        await db("DELETE FROM generation_events WHERE job_id = ? AND event_type <> 'cleanup_completed'", [job.id]);
        await event(db, job.id, "cleanup_completed", "completed");
      }
      await db("UPDATE cleanup_tasks SET cleanup_status = 'completed', completed_at = ?, last_error = NULL WHERE cleanup_id = ?", [Date.now(), task.cleanup_id]);
      done++;
    } catch (e) {
      await db("UPDATE cleanup_tasks SET cleanup_status = 'failed', retry_count = retry_count + 1, last_error = ? WHERE cleanup_id = ?", [String((e as Error)?.message ?? e).slice(0, 300), task.cleanup_id]);
    }
  }
  return done;
}
