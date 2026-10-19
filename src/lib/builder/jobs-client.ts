// Browser helper: starts a job and polls its real status until it finishes.
import type { JobType, JobView } from "./statuses";
import { isTerminal } from "./statuses";

async function json(res: Response) {
  const body: any = await res.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Error(`The backend returned an unreadable response (${res.status}). Please try again.`);
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export async function fetchJob(id: string): Promise<JobView | null> {
  const res = await fetch(`/api/jobs/${id}`, { credentials: "include", cache: "no-store" });
  if (res.status === 404) return null;
  return (await json(res)).job;
}

export async function listJobs(sessionId?: string): Promise<JobView[]> {
  const body = await json(await fetch(sessionId ? `/api/jobs?session=${encodeURIComponent(sessionId)}` : "/api/jobs", { credentials: "include", cache: "no-store" }));
  if (!Array.isArray(body.jobs)) throw new Error("Saved results could not be read. Please try again.");
  return body.jobs;
}

/** One status watcher per submission, including while POST is outstanding. */
function watchJob(id: string, onUpdate: (j: JobView) => void) {
  let stopped = false;
  let latest: JobView | null = null;
  let deadline = Number.POSITIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (j: JobView | null) => void = () => undefined;
  const result = new Promise<JobView | null>((resolve) => { settle = resolve; });
  const stop = () => { stopped = true; clearTimeout(timer); settle(latest); };
  const accept = (j: JobView) => {
    if (stopped) return;
    latest = j;
    onUpdate(j);
    if (isTerminal(j.status)) stop();
  };
  const tick = async () => {
    if (stopped) return;
    const j = await fetchJob(id).catch(() => null);
    if (j) accept(j);
    if (stopped) return;
    if (Date.now() >= deadline) { stop(); return; }
    timer = setTimeout(() => { void tick(); }, 1200);
  };
  timer = setTimeout(() => { void tick(); }, 1200);
  return { accept, stop, latest: () => latest, wait: () => { deadline = Date.now() + 45 * 60_000; return result; } };
}

/** Starts a job; `onUpdate` receives each polled status while the server works. */
export async function runJob(type: JobType, payload: { input?: unknown; file?: File; files?: File[]; prompt?: string; sessionId?: string | null }, onUpdate: (j: JobView) => void, existingId?: string): Promise<JobView> {
  const id = existingId ?? crypto.randomUUID();
  const watcher = watchJob(id, onUpdate);
  try {
    let res: Response;
    if (payload.files) {
      const fd = new FormData();
      fd.set("id", id); fd.set("type", "agent_task"); fd.set("prompt", payload.prompt ?? "");
      for (const f of payload.files) fd.append("file", f);
      if (payload.sessionId) fd.set("sessionId", payload.sessionId);
      res = await fetch("/api/jobs", { method: "POST", body: fd, credentials: "include" });
    } else if (payload.file) {
      const fd = new FormData();
      fd.set("id", id); fd.set("file", payload.file);
      if (payload.sessionId) fd.set("sessionId", payload.sessionId);
      res = await fetch("/api/jobs", { method: "POST", body: fd, credentials: "include" });
    } else {
      res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, type, input: payload.input, sessionId: payload.sessionId ?? undefined }), credentials: "include" });
    }
    const job: JobView = (await json(res)).job;
    // A terminal poll may precede a stale POST reply. Never regress it to running.
    watcher.accept(job);
    return (await watcher.wait()) ?? job;
  } catch (e) {
    // The request may have been cut off while the job kept running; trust the stored state.
    const latest = watcher.latest();
    if (latest && isTerminal(latest.status)) return latest;
    const j = await fetchJob(id).catch(() => latest);
    if (j) { watcher.accept(j); return j; }
    throw e;
  } finally { watcher.stop(); }
}

export async function cancelJob(id: string) {
  await json(await fetch(`/api/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }), credentials: "include" }));
}

export async function retryJob(id: string, onUpdate: (j: JobView) => void): Promise<JobView> {
  const newId = crypto.randomUUID();
  const watcher = watchJob(newId, onUpdate);
  try {
    const job: JobView = (await json(await fetch(`/api/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry", newId }), credentials: "include" }))).job;
    watcher.accept(job);
    return (await watcher.wait()) ?? job;
  } finally { watcher.stop(); }
}

export const downloadUrl = (artifactId: string) => `/api/artifacts/${artifactId}`;
