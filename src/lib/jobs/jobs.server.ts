// Persistent job state in D1: steps, statuses, warnings, cancellation, stale recovery and artifacts.
import { d1 } from "@/lib/cloud/d1.server";
import { isTerminal, recoveredStatus, JOB_STATUSES, type ArtifactRef, type JobStatus, type JobStep, type JobType, type JobView } from "@/lib/builder/statuses";

export const ARTIFACT_TTL_MS = 7 * 24 * 3600 * 1000;
export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();

export class CancelledError extends Error { constructor() { super("Cancelled"); } }

export async function createJob(id: string, userId: string, type: JobType, input: unknown, attempt = 1, sessionId: string | null = null) {
  if (!ID_RE.test(id)) throw new Error("Invalid job id");
  const t = now();
  await d1("INSERT INTO jobs (id, user_id, type, status, detail, input, attempt, session_id, steps, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'Accepted', ?, ?, ?, ?, ?, ?)",
    [id, userId, type, JSON.stringify(input ?? {}), attempt, sessionId, JSON.stringify([{ status: "queued", detail: "Accepted", at: t, endedAt: t, outcome: "ok" }]), t, t]);
  return new JobRun(id, userId);
}

/** Records real progress for one running job. Every write also proves the worker is alive. */
export class JobRun {
  steps: JobStep[] = [];
  warnings: string[] = [];
  readonly startedAt = Date.now();
  sessionId: string | null = null;
  constructor(public id: string, public userId: string) {}
  /** One structured line per finished job: outcome, timing and counts only — never inputs, outputs or file contents. */
  private diag(outcome: string, extra: Record<string, unknown> = {}) { console.log(JSON.stringify({ tag: "[job]", jobId: this.id, outcome, ms: Date.now() - this.startedAt, steps: this.steps.length, warnings: this.warnings.length, ...extra })); }
  /** Rebuilds a JobRun from a stored row so later processes can keep appending real steps. */
  static restore(r: any) { const j = new JobRun(r.id, r.user_id); j.steps = JSON.parse(r.steps || "[]"); j.warnings = JSON.parse(r.warnings || "[]"); j.sessionId = r.session_id ?? null; return j; }
  async cancelled() { await this.fail(new CancelledError()); }
  async timedOut(message: string) {
    this.closeLast("error");
    this.steps.push({ status: "timed_out", detail: message, at: now(), endedAt: now(), outcome: "error" });
    this.diag("timed_out");
    await d1("UPDATE jobs SET status = 'timed_out', detail = ?, progress = NULL, steps = ?, error = ?, updated_at = ? WHERE id = ?", [message, JSON.stringify(this.steps), message, now(), this.id]);
  }

  private async save(status: JobStatus, detail: string, progress: number | null = null) {
    await d1("UPDATE jobs SET status = ?, detail = ?, progress = ?, steps = ?, warnings = ?, updated_at = ? WHERE id = ?",
      [status, detail.slice(0, 300), progress, JSON.stringify(this.steps), JSON.stringify(this.warnings), now(), this.id]);
  }
  async step(status: JobStatus, detail: string, progress: number | null = null) {
    await this.checkCancel();
    const prev = this.steps[this.steps.length - 1];
    if (prev && !prev.endedAt) { prev.endedAt = now(); prev.outcome ??= "ok"; }
    this.steps.push({ status, detail, at: now() });
    await this.save(status, detail, progress);
  }
  async note(detail: string, progress: number | null = null) {
    const cur = this.steps[this.steps.length - 1];
    if (cur) cur.detail = detail;
    await this.save(cur?.status ?? "processing", detail, progress);
  }
  markCurrent(outcome: "ok" | "warn" | "error") { const cur = this.steps[this.steps.length - 1]; if (cur) cur.outcome = outcome; }
  warn(msg: string) { this.warnings.push(msg.slice(0, 400)); }
  async checkCancel() {
    const r = await d1<{ cancel_requested: number }>("SELECT cancel_requested FROM jobs WHERE id = ?", [this.id]);
    if (r[0]?.cancel_requested) throw new CancelledError();
  }
  async finish(result: unknown) {
    const status: JobStatus = this.warnings.length ? "completed_with_warnings" : "completed";
    this.diag(this.warnings.length ? "partial" : "completed");
    this.closeLast("ok");
    this.steps.push({ status, detail: JOB_STATUSES[status], at: now(), endedAt: now(), outcome: this.warnings.length ? "warn" : "ok" });
    await d1("UPDATE jobs SET status = ?, detail = ?, progress = NULL, steps = ?, warnings = ?, result = ?, updated_at = ? WHERE id = ?",
      [status, JOB_STATUSES[status], JSON.stringify(this.steps), JSON.stringify(this.warnings), JSON.stringify(result ?? null), now(), this.id]);
  }
  async fail(e: unknown, partial?: unknown) {
    const cancelled = e instanceof CancelledError;
    const status: JobStatus = cancelled ? "cancelled" : "failed";
    const message = cancelled ? "Cancelled" : safeError(e);
    this.diag(cancelled ? "cancelled" : "failed", { kind: (e as any)?.name === "SupersededError" ? "superseded" : cancelled ? "cancelled" : "error" });
    this.closeLast(cancelled ? "warn" : "error");
    this.steps.push({ status, detail: message, at: now(), endedAt: now(), outcome: cancelled ? "warn" : "error" });
    await d1("UPDATE jobs SET status = ?, detail = ?, progress = NULL, steps = ?, warnings = ?, error = ?, result = ?, updated_at = ? WHERE id = ?",
      [status, message, JSON.stringify(this.steps), JSON.stringify(this.warnings), cancelled ? null : message, partial ? JSON.stringify(partial) : null, now(), this.id]).catch(() => undefined);
  }
  private closeLast(outcome: "ok" | "warn" | "error") { const cur = this.steps[this.steps.length - 1]; if (cur && !cur.endedAt) { cur.endedAt = now(); cur.outcome ??= outcome; } }

  /** Heartbeat for long-running steps: refreshes updated_at so stale recovery never kills a live job. */
  async touch() {
    await d1("UPDATE jobs SET updated_at = ? WHERE id = ? AND status NOT IN ('completed','completed_with_warnings','failed','cancelled','timed_out')", [now(), this.id]);
  }

  async saveArtifact(name: string, mime: string, bytes: Uint8Array, kind: ArtifactRef["kind"] | "source"): Promise<ArtifactRef> {
    await this.checkCancel();
    const { putArtifact, putD1Artifact, getArtifactBytes } = await import("./artifact-store.server");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const identity = `${this.id}:${kind}:${name}:${hash}`;
    const existing = await d1<any>("SELECT id, name, size FROM job_artifacts WHERE job_id = ? AND user_id = ? AND name = ? AND kind = ? AND sha256 = ?", [this.id, this.userId, name, kind, hash]);
    if (existing[0]) return { id: existing[0].id, name: existing[0].name, size: existing[0].size, kind: kind === "source" ? "file" : kind };
    const driveId = kind === "source" ? (await putD1Artifact(bytes)).key : await putArtifact(name, mime, bytes, identity, this.userId);
    const identityHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${this.userId}:${identity}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
    const id = `${identityHash.slice(0,8)}-${identityHash.slice(8,12)}-${identityHash.slice(12,16)}-${identityHash.slice(16,20)}-${identityHash.slice(20,32)}`;
    // Verify before delivery: read the stored bytes back and compare size + hash, so a corrupt or
    // partial write fails the task honestly instead of handing the user a damaged file.
    try {
      const back = await getArtifactBytes(driveId);
      const backHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", back as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (back.length !== bytes.length || backHash !== hash) throw new Error("integrity mismatch");
    } catch (e) {
      const { deleteArtifactBytes } = await import("./artifact-store.server");
      await deleteArtifactBytes(driveId).catch(() => undefined);
      throw new Error("The file could not be stored correctly. Please run the task again.");
    }
    await d1("INSERT OR IGNORE INTO job_artifacts (id, job_id, user_id, name, mime, size, sha256, drive_file_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, this.id, this.userId, name, mime, bytes.length, hash, driveId, kind, new Date(Date.now() + ARTIFACT_TTL_MS).toISOString(), now()]);
    if (kind !== "source") {
      const { markDriveIndexed } = await import("@/lib/cloud/drive.server");
      await markDriveIndexed(identity);
    }
    return { id, name, size: bytes.length, kind: kind === "source" ? "file" : kind };
  }
}

/** Errors shown to users never include stack traces or secrets. */
export function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "Unknown error");
  return m.replace(/(Bearer\s+)[\w.-]+/gi, "$1[redacted]").replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 300) || "Unknown error";
}

function toView(r: any, artifacts: ArtifactRef[]): JobView {
  return {
    id: r.id, type: r.type, status: r.status, detail: r.detail ?? "", progress: r.progress ?? null,
    steps: JSON.parse(r.steps || "[]"), warnings: JSON.parse(r.warnings || "[]"), error: r.error ?? null,
    result: r.result ? JSON.parse(r.result) : null, artifacts, sessionId: r.session_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Marks jobs whose worker stopped reporting as failed, so the UI never shows a frozen "running" state. */
async function recover(r: any) {
  if (r.type === "runtime_task" && !isTerminal(r.status)) {
    // Runtime jobs run on GitHub; their own deadline/run checks decide failure, not the stale timer.
    const { syncRuntimeJob } = await import("@/lib/runtime/runtime.server");
    if (await syncRuntimeJob(r).catch((e) => { console.error("[runtime] sync", safeError(e)); return false; })) {
      return (await d1<any>("SELECT * FROM jobs WHERE id = ?", [r.id]))[0] ?? r;
    }
    return r;
  }
  const s = recoveredStatus(r.status, r.updated_at);
  if (s === r.status) return r;
  const steps = JSON.parse(r.steps || "[]");
  const t = now();
  steps.push({ status: "failed", detail: "Interrupted — the worker stopped responding", at: t, endedAt: t, outcome: "error" });
  await d1("UPDATE jobs SET status = 'failed', detail = ?, error = ?, steps = ?, updated_at = ? WHERE id = ? AND status = ?",
    ["Interrupted", "The task was interrupted before it finished. You can retry it.", JSON.stringify(steps), t, r.id, r.status]);
  return { ...r, status: "failed", detail: "Interrupted", error: "The task was interrupted before it finished. You can retry it.", steps: JSON.stringify(steps), updated_at: t };
}

async function artifactsFor(jobIds: string[], userId: string): Promise<Map<string, ArtifactRef[]>> {
  const map = new Map<string, ArtifactRef[]>();
  if (!jobIds.length) return map;
  const rows = await d1<any>(`SELECT id, job_id, name, size, kind FROM job_artifacts WHERE user_id = ? AND kind != 'source' AND expires_at > ? AND job_id IN (${jobIds.map(() => "?").join(",")})`, [userId, now(), ...jobIds]);
  for (const a of rows) { const l = map.get(a.job_id) ?? []; l.push({ id: a.id, name: a.name, size: a.size, kind: a.kind }); map.set(a.job_id, l); }
  return map;
}

export async function getJob(userId: string, id: string): Promise<JobView | null> {
  if (!ID_RE.test(id)) return null;
  const rows = await d1<any>("SELECT * FROM jobs WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows[0]) return null;
  const r = await recover(rows[0]);
  return toView(r, (await artifactsFor([id], userId)).get(id) ?? []);
}

export async function getJobInput(userId: string, id: string): Promise<{ type: JobType; input: any; attempt: number; status: JobStatus; sessionId: string | null } | null> {
  const rows = await d1<any>("SELECT type, input, attempt, status, updated_at, session_id FROM jobs WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows[0]) return null;
  return { type: rows[0].type, input: JSON.parse(rows[0].input || "{}"), attempt: rows[0].attempt ?? 1, status: rows[0].type === "runtime_task" ? rows[0].status : recoveredStatus(rows[0].status, rows[0].updated_at), sessionId: rows[0].session_id ?? null };
}

export async function listJobs(userId: string, limit = 30, sessionId?: string): Promise<JobView[]> {
  await cleanupExpired(userId).catch(() => undefined);
  const rows = sessionId
    ? await d1<any>("SELECT * FROM jobs WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ?", [userId, sessionId, limit])
    : await d1<any>("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [userId, limit]);
  const recovered = await Promise.all(rows.map(recover));
  const arts = await artifactsFor(recovered.map((r) => r.id), userId);
  return recovered.map((r) => toView(r, arts.get(r.id) ?? []));
}

export async function requestCancel(userId: string, id: string): Promise<boolean> {
  const job = await getJob(userId, id);
  if (!job || isTerminal(job.status)) return false;
  await d1("UPDATE jobs SET cancel_requested = 1 WHERE id = ? AND user_id = ?", [id, userId]);
  return true;
}

export async function getArtifact(userId: string, id: string) {
  if (!ID_RE.test(id)) return null;
  const rows = await d1<any>("SELECT * FROM job_artifacts WHERE id = ? AND user_id = ?", [id, userId]);
  const a = rows[0];
  if (!a || Date.parse(a.expires_at) <= Date.now()) return null;
  return a as { id: string; name: string; mime: string; size: number; drive_file_id: string; kind: string; sha256: string };
}

/** Deletes a few expired artifacts per call (bounded so a page load never does heavy work). */
export async function cleanupExpired(userId: string) {
  const rows = await d1<any>("SELECT id, drive_file_id FROM job_artifacts WHERE user_id = ? AND expires_at <= ? LIMIT 5", [userId, now()]);
  if (!rows.length) return;
  const { deleteArtifactBytes } = await import("./artifact-store.server");
  for (const r of rows) { await deleteArtifactBytes(r.drive_file_id); await d1("DELETE FROM job_artifacts WHERE id = ?", [r.id]); }
}
