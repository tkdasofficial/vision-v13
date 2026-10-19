// GitHub Actions calls for the fixed Vision-Runtime repo. The PAT is read server-side only and never returned or logged.
import type { RuntimeOpId } from "./operations";

const API = "https://api.github.com/repos/tkdasofficial/vision-runtime";

export class GithubError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function gh(path: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  const { getSecret } = await import("@/lib/ai/runtime-env.server");
  const token = getSecret("GITHUB_PAT");
  if (!token) throw new GithubError("Background runtime is not configured (GitHub access key missing in Cloudflare).", 503);
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "vision-app", ...(init.headers ?? {}) } });
    if (res.status !== 429 && res.status < 500) return res;
    last = res;
    const wait = Math.min(Number(res.headers.get("retry-after") ?? 0) * 1000 || 800 * 2 ** i, 5000);
    await new Promise((r) => setTimeout(r, wait + Math.random() * 300));
  }
  return last!;
}

/** Dispatches one job. Returns the run id when GitHub provides it. */
export async function dispatchRun(jobId: string, operation: RuntimeOpId, source?: unknown, fileName?: unknown): Promise<string | null> {
  const { pickWorkflow } = await import("./workflows");
  const workflow = pickWorkflow(operation, source, fileName);
  if (!workflow) throw new GithubError("This file type is not handled by the background runtime.", 400);
  const inputs = { job_id: jobId, operation };
  const res = await gh(`/actions/workflows/${workflow}.yml/dispatches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main", inputs, return_run_details: true }) }, 2);
  if (res.status === 200 || res.status === 204) {
    const body: any = res.status === 200 ? await res.json().catch(() => null) : null;
    return body?.workflow_run_id ? String(body.workflow_run_id) : null;
  }
  const text = (await res.text().catch(() => "")).slice(0, 200);
  console.error("[runtime] dispatch failed", res.status, text);
  throw new GithubError(res.status === 401 || res.status === 403 || res.status === 404 ? "The background runtime rejected the request (GitHub access)." : res.status === 429 ? "GitHub is rate-limiting background jobs. Try again shortly." : "Could not start the background job.", res.status);
}

export async function getRun(runId: string): Promise<{ status: string; conclusion: string | null; workflowPath: string } | null> {
  if (!/^\d+$/.test(runId)) return null;
  const res = await gh(`/actions/runs/${runId}`, {}, 1);
  if (!res.ok) return null;
  const r: any = await res.json();
  return { status: r.status, conclusion: r.conclusion, workflowPath: r.path };
}

export async function cancelRun(runId: string) {
  if (!/^\d+$/.test(runId)) return;
  await gh(`/actions/runs/${runId}/cancel`, { method: "POST" }, 1).catch(() => undefined);
}
