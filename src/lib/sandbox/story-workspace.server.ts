// Mirrors one Cloudflare story job (runtime_jobs) into the per-job prompt workspace (migration 0005).
// The existing slot runner stays the engine; this layer only records what actually happened:
// request + metadata + constraints, complete prompt versions, attempts, validation scores/findings,
// timings, lifecycle and cleanup scheduling. Every write is idempotent or append-only and
// failure-tolerant, so a workspace hiccup can never break generation or delivery.
import * as ws from "./workspace";
import type { Db } from "./workspace";

const idemKey = (jobId: string) => `runtime:${jobId}`;
const log = (what: string, e: unknown) => console.error(JSON.stringify({ tag: "[story-workspace]", what, error: String((e as Error)?.message ?? e).slice(0, 200) }));

async function defaultDb(): Promise<Db | null> {
  const { sandboxDb, sandboxReady } = await import("./db.server");
  return sandboxReady() ? sandboxDb : null;
}

/** Splits deterministic scene issues into continuity (order, setting, scene identity) vs consistency (everything else). */
export function splitScores(issues: string[]): { consistency: number; continuity: number; findings: ws.Finding[] } {
  const isContinuity = (s: string) => /\b(scene \d+ (heading|number|order)|order|sequence|background|setting|location|previous scene|continu)/i.test(s);
  const cont = issues.filter(isContinuity);
  const cons = issues.filter((s) => !isContinuity(s));
  const score = (n: number) => Math.max(0, 100 - n * 25);
  return {
    consistency: score(cons.length),
    continuity: score(cont.length),
    findings: issues.map((d) => ({ issueType: isContinuity(d) ? "continuity" : "consistency", severity: "high" as const, description: d.slice(0, 500), requiredFix: "Repair the scene so this check passes." })),
  };
}

export type StoryWorkspace = Awaited<ReturnType<typeof openStoryWorkspace>>;

/**
 * Opens (or resumes) the workspace for a runtime story job. Returns no-op hooks when the job has no
 * chat or the sandbox store is unreachable, so the engine runs exactly as before.
 */
export async function openStoryWorkspace(input: {
  userId: string; jobId: string; chatId: string | null; prompt: string; count: number;
  meta: { headings: string[]; dialogue?: { min: number; max: number } | null; fixedBackground: boolean };
  queuedAt?: number; db?: Db | null;
}) {
  const db = input.db === undefined ? await defaultDb() : input.db;
  let jobId: string | null = null;
  const slotIds = new Map<number, string>();
  const safe = async <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (!db || !jobId) return undefined;
    try { return await fn(); } catch (e) { log(what, e); return undefined; }
  };

  if (db && input.chatId) {
    try {
      const { job, slots } = await ws.initJob(db, input.userId, {
        chatId: input.chatId, originalRequest: input.prompt, requestedPromptCount: input.count,
        idempotencyKey: idemKey(input.jobId), messageId: `job-${input.jobId}`, sourcePage: "chat",
        // The chat id comes from the owner-scoped jobs row of this runtime job, never from a client.
        ownsChat: async (c) => c === input.chatId,
      });
      jobId = job.id;
      for (const s of slots) slotIds.set(s.slot_index, s.slot_id);
      if (job.workflow_status === "queued") {
        const t = Date.now();
        await db("INSERT OR IGNORE INTO request_context (context_id, job_id, task_type, output_format, requested_prompt_count, normalized_request, extraction_status, created_at) VALUES (?, ?, 'story_prompts', 'markdown', ?, ?, 'extracted', ?)",
          [crypto.randomUUID(), jobId, input.count, JSON.stringify(input.meta), t]);
        const rules: [string, string][] = [
          ["required_element", `Exactly ${input.count} scenes, each with sections: ${input.meta.headings.join(", ")}`],
          ["consistency_rule", "Keep every character's name, appearance and clothing exactly as in the blueprint."],
          ["continuity_rule", "Scenes follow the story in order with logical scene-to-scene continuity."],
        ];
        if (input.meta.dialogue) rules.push(["required_element", `Dialogue of ${input.meta.dialogue.min}-${input.meta.dialogue.max} spoken words per scene`]);
        if (input.meta.fixedBackground) rules.push(["continuity_rule", "Same single background/setting in every scene."]);
        const existing = (await db("SELECT COUNT(*) AS n FROM request_constraints WHERE job_id = ?", [jobId]))[0]?.n ?? 0;
        if (!existing) for (const [type, value] of rules) await db("INSERT INTO request_constraints (constraint_id, job_id, constraint_type, constraint_value, is_mandatory, created_at) VALUES (?, ?, ?, ?, 1, ?)", [crypto.randomUUID(), jobId, type, value, t]);
        await ws.saveVersion(db, input.userId, slotIds.get(1)!, input.prompt);
        await ws.setSlotStatus(db, input.userId, slotIds.get(1)!, "completed");
        await ws.saveVersion(db, input.userId, slotIds.get(2)!, JSON.stringify({ count: input.count, ...input.meta }));
        await ws.setSlotStatus(db, input.userId, slotIds.get(2)!, "completed");
        await ws.transition(db, input.userId, jobId, "initializing");
        await ws.transition(db, input.userId, jobId, "generating");
        if (input.queuedAt) await ws.recordTiming(db, input.userId, jobId, { queueWaitMs: Math.max(0, Date.now() - input.queuedAt) });
      }
    } catch (e) { log("init", e); jobId = null; }
  }

  const uid = input.userId;
  const attempt = (slotIndex: number, type: "generation" | "repair" | "retry", startedAt: number, ok: boolean, code?: string) => safe("attempt", async () => {
    const slotId = slotIds.get(slotIndex)!;
    const n = ((await db!("SELECT MAX(attempt_number) AS n FROM generation_attempts WHERE slot_id = ? AND attempt_type = ?", [slotId, type]))[0]?.n ?? 0) + 1;
    await db!("INSERT INTO generation_attempts (attempt_id, job_id, slot_id, attempt_type, attempt_number, status, started_at, ended_at, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), jobId, slotId, type, n, ok ? "succeeded" : "failed", startedAt, Date.now(), code ?? null]);
    const ms = Date.now() - startedAt;
    await ws.recordTiming(db!, uid, jobId!, type === "generation" ? { slotId, generationMs: ms } : { slotId, repairMs: ms });
  });

  return {
    active: () => !!jobId,
    workspaceJobId: () => jobId,
    heartbeat: () => safe("heartbeat", () => ws.heartbeat(db!, uid, jobId!)),
    blueprint: (content: string) => safe("blueprint", async () => {
      await ws.saveVersion(db!, uid, slotIds.get(3)!, content);
      await ws.setSlotStatus(db!, uid, slotIds.get(3)!, "completed");
    }),
    attempt,
    /** Stores the complete candidate for prompt i (0-based) and records its measured scores and findings. */
    validated: (i: number, content: string, issues: string[], kind: "generation" | "repair" | "retry") => safe("validate", async () => {
      const slotIndex = 4 + i;
      const slotId = slotIds.get(slotIndex)!;
      const t = Date.now();
      await ws.setSlotStatus(db!, uid, slotId, kind === "generation" ? "validating" : "repairing");
      await ws.transition(db!, uid, jobId!, "validating");
      const { versionId } = await ws.saveVersion(db!, uid, slotId, content);
      const s = splitScores(issues);
      const r = await ws.recordValidation(db!, uid, versionId, { consistency: s.consistency, continuity: s.continuity, summary: `${kind}: ${issues.length} issue(s)`, findings: s.findings });
      await ws.recordTiming(db!, uid, jobId!, { slotId, validationMs: Date.now() - t });
      await ws.transition(db!, uid, jobId!, r.status === "passed" ? "generating" : "repairing");
      return r.status;
    }),
    slotDone: (i: number, passed: boolean) => safe("slot", () => ws.setSlotStatus(db!, uid, slotIds.get(4 + i)!, passed ? "completed" : "failed")),
    finalValidation: (issues: string[]) => safe("final", async () => {
      await ws.transition(db!, uid, jobId!, "validating"); // from "generating" after the last pass; no-op otherwise
      await ws.transition(db!, uid, jobId!, "final_validating");
      await db!("INSERT INTO generation_events (job_id, event_type, status, detail, created_at) VALUES (?, 'final_validation', ?, ?, ?)", [jobId, issues.length ? "failed" : "passed", issues.slice(0, 5).join(" | ").slice(0, 500) || null, Date.now()]);
      if (!issues.length) await ws.transition(db!, uid, jobId!, "delivering");
    }),
    failed: (code: string) => safe("fail", () => ws.transition(db!, uid, jobId!, "failed", code.slice(0, 60))),
  };
}

/** Called after the runtime finalizer: success schedules cleanup only once the reply is saved in chat history. */
export async function closeStoryWorkspace(userId: string, runtimeJobId: string, delivered: boolean, db?: Db | null) {
  const d = db === undefined ? await defaultDb() : db;
  if (!d) return;
  try {
    const job = (await d("SELECT id, workflow_status FROM generation_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1", [userId, idemKey(runtimeJobId)]))[0];
    if (!job) return;
    if (delivered) {
      if (job.workflow_status === "final_validating") await ws.transition(d, userId, job.id, "delivering");
      if (await ws.transition(d, userId, job.id, "succeeded")) {
        const started = (await d("SELECT created_at FROM generation_jobs WHERE id = ?", [job.id]))[0]?.created_at;
        await d("INSERT INTO generation_events (job_id, event_type, status, detail, created_at) VALUES (?, 'delivered', 'succeeded', ?, ?)", [job.id, started ? `total_ms=${Date.now() - started}` : null, Date.now()]);
        await ws.scheduleCleanup(d, userId, job.id);
      }
    } else if (!["succeeded", "failed", "cancelled", "expired"].includes(job.workflow_status)) {
      await ws.transition(d, userId, job.id, "failed", "delivery_failed");
    }
  } catch (e) { log("close", e); }
}
