// Long Context Generation runner: plan → chunked generation (hybrid parallel) →
// assemble → validate → persist output. Resumable from persisted checkpoints;
// cancellation is cooperative and never corrupts completed chunks.
import { orchestrateText, type Completion } from "../ai/orchestrator.server";
import { assemble, buildChunkContext, buildPlan, chunkMessages, estimateTokens, scheduleWaves, validateAssembly, type Plan } from "./generation";
import * as store from "./store.server";
import type { SandboxDb } from "./db.server";

const MAX_CONCURRENT = 3;
const OUTLINE_MAX_TOKENS = 800;

export type RunResult = { status: "completed" | "failed" | "cancelled"; outputVersion?: number; error?: string };

type Call = (messages: unknown[], maxTokens: number, signal: AbortSignal) => Promise<Completion>;
const defaultCall: Call = (messages, maxTokens, signal) =>
  orchestrateText(messages, { maxTokens, deep: false, signal, taskId: "sandbox" });

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

async function isCancelled(userId: string, jobId: string, db: SandboxDb): Promise<boolean> {
  return (await store.getJob(userId, jobId, db))?.status === "cancelled";
}

/** Generates a structured outline from the instructions; falls back to one chunk. */
export async function planOutline(instructions: string, call: Call, signal: AbortSignal): Promise<string[]> {
  const res = await call([
    { role: "system", content: "Split the requested work into an ordered outline of 2-12 sections. Reply with a JSON array of short section titles and nothing else." },
    { role: "user", content: instructions },
  ], OUTLINE_MAX_TOKENS, signal);
  if (res.ok) {
    try {
      const arr = JSON.parse(res.text.replace(/```json|```/g, "").trim());
      if (Array.isArray(arr) && arr.every((s) => typeof s === "string")) return arr;
    } catch { /* fall through to single-chunk plan */ }
  }
  return [];
}

/**
 * Runs (or resumes) a generation job. Completed chunks are never regenerated;
 * failed/stale chunks are retried; independent chunks run in parallel waves.
 */
export async function runJob(userId: string, jobId: string, opts: { db?: SandboxDb; call?: Call; signal?: AbortSignal } = {}): Promise<RunResult> {
  const db = opts.db ?? (await import("./db.server")).sandboxDb;
  const call = opts.call ?? defaultCall;
  const signal = opts.signal ?? new AbortController().signal;
  const job = await store.getJob(userId, jobId, db);
  if (!job) return { status: "failed", error: "Job not found" };
  if (job.status === "cancelled") return { status: "cancelled" };
  if (job.status === "completed") return { status: "completed" };

  try {
  // 1) Plan (or load a persisted one when resuming).
  let plan: Plan | null = await store.loadPlan(userId, jobId, db);
  if (!plan) {
    await store.setJobStatus(userId, jobId, ["pending", "failed"], "planning", {}, db);
    const outline = await planOutline(job.instructions, call, signal);
    if (signal.aborted || (await isCancelled(userId, jobId, db))) return { status: "cancelled" };
    plan = buildPlan(job.instructions, outline);
    await store.savePlan(userId, jobId, plan, db);
    await store.setJobStatus(userId, jobId, null, "generating", { total_chunks: plan.chunks.length }, db);
  } else {
    await store.setJobStatus(userId, jobId, ["pending", "planning", "failed"], "generating", { total_chunks: plan.chunks.length }, db);
    await store.markRetryable(userId, jobId, db);
  }

  // 2) Generate chunk waves; dependencies stay sequential, independents parallel.
  const activePlan = plan;
  const waves = scheduleWaves(activePlan.chunks);
  for (const wave of waves) {
    if (signal.aborted || (await isCancelled(userId, jobId, db))) return { status: "cancelled" };
    const chunks = await store.listChunks(userId, jobId, db);
    const done = chunks.flatMap((c) => c.status === "completed" && c.content ? [{ seq: c.seq, sectionId: c.section_id, title: activePlan.chunks[c.seq]?.title ?? c.section_id, content: c.content }] : []);
    let waveFailed = false;
    await runLimited(wave, MAX_CONCURRENT, async (seq) => {
      const existing = chunks.find((c) => c.seq === seq);
      if (existing?.status === "completed" && existing.content) return; // never regenerate
      const claimed = await store.claimChunk(userId, jobId, seq, db);
      if (!claimed) return; // another runner owns it
      const spec = activePlan.chunks[seq];
      if (!spec) throw new Error("Generation section is missing.");
      const ctx = buildChunkContext({ instructions: job.instructions, outline: activePlan.outline, chunk: spec, completed: done, policy: activePlan.contextPolicy });
      let res: Completion;
      try { res = await call(chunkMessages(ctx, spec.tokenBudget), spec.tokenBudget, signal); }
      catch (e) {
        const { safeError } = await import("../jobs/jobs.server");
        await store.failChunk(userId, jobId, seq, safeError(e), db);
        throw e;
      }
      if (res.ok && res.text.trim()) {
        const ok = await store.completeChunk(userId, jobId, seq, res.text.trim(), estimateTokens(res.text), db);
        if (ok) done.push({ seq, sectionId: spec.sectionId, title: spec.title, content: res.text.trim() });
      } else {
        waveFailed = true;
        await store.failChunk(userId, jobId, seq, res.ok ? "Empty chunk" : res.reason, db);
      }
    });
    if (waveFailed) {
      // Failed chunks stay retryable; the job reports failure with its checkpoint intact.
      const left = (await store.listChunks(userId, jobId, db)).filter((c) => c.status !== "completed");
      if (left.length) {
        await store.setJobStatus(userId, jobId, null, "failed", { error: `${left.length} chunk(s) failed; retry to resume.` }, db);
        return { status: "failed", error: "One or more chunks failed" };
      }
    }
  }

  // 3) Assemble + validate.
  if (signal.aborted || (await isCancelled(userId, jobId, db))) return { status: "cancelled" };
  await store.setJobStatus(userId, jobId, ["generating"], "assembling", {}, db);
  const final = await store.listChunks(userId, jobId, db);
  const validation = validateAssembly(final, activePlan.chunks.length);
  const content = assemble(final.map((c) => ({ seq: c.seq, content: c.content })));
  const version = await store.saveOutput(userId, jobId, content, validation.ok, validation.ok ? undefined : validation.problems.join("; "), db);
  if (!validation.ok) {
    await store.setJobStatus(userId, jobId, null, "failed", { error: "Output validation failed" }, db);
    return { status: "failed", error: "Output validation failed" };
  }
  await store.setJobStatus(userId, jobId, ["assembling", "generating"], "completed", {}, db);
  return { status: "completed", outputVersion: version };
  } catch (e) {
    const { safeError } = await import("../jobs/jobs.server");
    const error = safeError(e);
    console.error("[sandbox] failed", { jobId, error });
    try { await store.setJobStatus(userId, jobId, ["pending", "planning", "generating", "validating", "assembling"], "failed", { error }, db); }
    catch (persistError) { console.error("[sandbox] failure state not saved", { jobId, error: safeError(persistError) }); }
    throw e;
  }
}

/** Retry: marks failed chunks retryable and resumes without touching completed work. */
export async function retryJob(userId: string, jobId: string, opts: Parameters<typeof runJob>[2] = {}): Promise<RunResult> {
  await store.markRetryable(userId, jobId, opts.db);
  return runJob(userId, jobId, opts);
}

export async function cancelJob(userId: string, jobId: string, db?: SandboxDb): Promise<boolean> {
  return store.setJobStatus(userId, jobId, ["pending", "planning", "generating", "validating", "assembling", "failed"], "cancelled", {}, db);
}
