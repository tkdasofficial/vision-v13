// Agent-task checkpoints: the minimum state needed to resume a tool chain without redoing finished steps.
// Pure and tested. Checkpoints hold the plan, finished step summaries and output-artifact ids — never file
// bytes, secrets or the conversation. Saved content is treated as untrusted and re-validated before reuse.
export const CHECKPOINT_VERSION = 1;
export const CHECKPOINT_MAX_CHARS = 200_000;
export const CHECKPOINT_MAX_STEPS = 6;
/** A checkpoint older than this is not resumed: its output files may have expired or the request gone stale. */
export const CHECKPOINT_TTL_MS = 6 * 24 * 3600 * 1000;

export type CheckpointStep = { tool: string; params?: Record<string, unknown>; why?: string };
export type DoneStep = { index: number; result: Record<string, any>; artifactIds: string[] };
export type AgentCheckpoint = {
  v: number;
  /** Owner and original job; a resume must match both. */
  owner: string;
  jobId: string;
  plan: { steps: CheckpointStep[]; reply?: string };
  done: DoneStep[];
  /** Step that was running when the checkpoint was last written; its result is unknown, so it reruns. */
  running: number | null;
  lastText: string;
  savedAt: string;
};

export function emptyCheckpoint(owner: string, jobId: string, plan: AgentCheckpoint["plan"], now = new Date()): AgentCheckpoint {
  return { v: CHECKPOINT_VERSION, owner, jobId, plan, done: [], running: null, lastText: "", savedAt: now.toISOString() };
}

export function serialize(cp: AgentCheckpoint): string {
  let s = JSON.stringify(cp);
  // Bound growth: drop large step texts first, never the structure needed to resume.
  if (s.length > CHECKPOINT_MAX_CHARS) s = JSON.stringify({ ...cp, lastText: cp.lastText.slice(0, 20_000), done: cp.done.map((d) => ({ ...d, result: { ...d.result, text: String(d.result.text ?? "").slice(0, 4000), data: undefined } })) });
  return s;
}

export type CheckpointCheck = { ok: true; cp: AgentCheckpoint } | { ok: false; reason: string };

/** Validates a stored checkpoint before use: shape, version, owner, origin job, age, tool ids and step indexes. */
export function validateCheckpoint(raw: unknown, expect: { owner: string; jobId: string; knownTool: (id: string) => boolean; now?: number }): CheckpointCheck {
  let cp: any = raw;
  if (typeof raw === "string") { if (raw.length > CHECKPOINT_MAX_CHARS * 2) return { ok: false, reason: "too large" }; try { cp = JSON.parse(raw); } catch { return { ok: false, reason: "malformed" }; } }
  if (!cp || typeof cp !== "object") return { ok: false, reason: "missing" };
  if (cp.v !== CHECKPOINT_VERSION) return { ok: false, reason: "incompatible version" };
  if (cp.owner !== expect.owner) return { ok: false, reason: "owner mismatch" };
  if (cp.jobId !== expect.jobId) return { ok: false, reason: "job mismatch" };
  const age = (expect.now ?? Date.now()) - Date.parse(cp.savedAt);
  if (!Number.isFinite(age) || age < 0 || age > CHECKPOINT_TTL_MS) return { ok: false, reason: "expired" };
  const steps = cp.plan?.steps;
  if (!Array.isArray(steps) || !steps.length || steps.length > CHECKPOINT_MAX_STEPS) return { ok: false, reason: "invalid plan" };
  if (steps.some((s: any) => !s || typeof s.tool !== "string" || !expect.knownTool(s.tool) || (s.params != null && typeof s.params !== "object"))) return { ok: false, reason: "unknown tool" };
  if (!Array.isArray(cp.done)) return { ok: false, reason: "invalid steps" };
  const seen = new Set<number>();
  for (let i = 0; i < cp.done.length; i++) {
    const d = cp.done[i];
    // Done steps must be the contiguous prefix 0..k-1: resuming never skips an unfinished step.
    if (!d || d.index !== i || seen.has(d.index) || d.index >= steps.length || !Array.isArray(d.artifactIds) || d.artifactIds.some((a: any) => typeof a !== "string") || typeof d.result !== "object") return { ok: false, reason: "invalid steps" };
    seen.add(d.index);
  }
  if (typeof cp.lastText !== "string") return { ok: false, reason: "invalid text" };
  return { ok: true, cp: cp as AgentCheckpoint };
}

/** Which plan steps still have to run. A step that was mid-run when the worker died is re-run, never assumed done. */
export function pendingSteps(cp: AgentCheckpoint): number[] {
  const out: number[] = [];
  for (let i = cp.done.length; i < cp.plan.steps.length; i++) out.push(i);
  return out;
}

/** Re-keys a validated checkpoint to the new job that continues it. */
export function rebind(cp: AgentCheckpoint, newJobId: string, now = new Date()): AgentCheckpoint {
  return { ...cp, done: [...cp.done], jobId: newJobId, running: null, savedAt: now.toISOString() };
}
