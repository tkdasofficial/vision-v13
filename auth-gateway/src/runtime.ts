// Runtime relay: the only way GitHub Actions runners touch VISION data.
// A runner proves who it is with a GitHub OIDC token (repo + workflow + branch pinned),
// claims one dispatched job, then gets a short session to read its input chunks and write its output.
// No credential is ever passed to GitHub; file bytes never go through GitHub.
//
//   POST /runtime/claim                 (Authorization: Bearer <GitHub OIDC JWT>) {job_id}
//   GET  /runtime/input/:idx            (Authorization: Bearer <session>)
//   POST /runtime/progress              {stage}
//   POST /runtime/output/:idx           base64 text body
//   POST /runtime/complete              {ok, error?, result?, output?}

import { WORKFLOWS, pickWorkflow, workflowRef } from "../../src/lib/runtime/workflows";
import { DIAGNOSTIC_LIMITS, parseDiagnostic } from "../../src/lib/runtime/diagnostics";

type D1Database = { prepare(sql: string): { bind(...v: unknown[]): { first<T = any>(): Promise<T | null>; run(): Promise<unknown> } } };
export interface RuntimeEnv { DB: D1Database }

const REPO = "tkdasofficial/vision-runtime";
const WORKFLOW_REFS = new Map(Object.keys(WORKFLOWS).map((f) => [workflowRef(REPO, f), f]));
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "vision-runtime-relay";
const SESSION_TTL_MS = 40 * 60 * 1000;
const MAX_OUTPUT_CHUNKS = 160; // x 700 KB ≈ 110 MB hard ceiling; per-operation limits are enforced by the app
const STAGES = new Set(["validating_input", "processing", "validating_output", "uploading_output", "planning", "assembling"]);
const STAGE_RE = /^writing_scene_\d{1,2}$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enc = new TextEncoder();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const now = () => new Date().toISOString();
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

let jwksCache: { at: number; keys: any[] } | null = null;
async function jwks(): Promise<any[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`${ISSUER}/.well-known/jwks`);
  if (!r.ok) throw new Error("jwks unavailable");
  jwksCache = { at: Date.now(), keys: ((await r.json()) as any).keys };
  return jwksCache.keys;
}

/** Verifies a GitHub Actions OIDC token and pins it to our repo, workflow file and main branch. */
export async function verifyGithubOidc(token: string): Promise<{ runId: string; workflow: string } | null> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let header: any, claims: any;
  try { header = JSON.parse(new TextDecoder().decode(fromB64u(h))); claims = JSON.parse(new TextDecoder().decode(fromB64u(p))); } catch { return null; }
  if (header.alg !== "RS256") return null;
  const jwk = (await jwks()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(s), enc.encode(`${h}.${p}`)))) return null;
  const t = Date.now() / 1000;
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE || !(claims.exp > t) || claims.nbf > t + 60) return null;
  if (claims.repository !== REPO || !WORKFLOW_REFS.has(claims.job_workflow_ref) || claims.ref !== "refs/heads/main") return null;
  if (claims.event_name !== "workflow_dispatch" || !/^\d+$/.test(String(claims.run_id))) return null;
  const workflow = WORKFLOW_REFS.get(claims.job_workflow_ref);
  return workflow ? { runId: String(claims.run_id), workflow } : null;
}

async function session(req: Request, env: RuntimeEnv): Promise<any | null> {
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (tok.length < 40) return null;
  const row = await env.DB.prepare("SELECT * FROM runtime_jobs WHERE session_hash = ?").bind(await sha256(tok)).first();
  if (!row || row.status !== "running" || Date.parse(row.session_expires) < Date.now()) return null;
  return row;
}

export async function handleRuntime(req: Request, env: RuntimeEnv, path: string): Promise<Response> {
  if (!env.DB) return json(503, { error: "relay not configured" });
  try {
    if (path === "/runtime/claim" && req.method === "POST") {
      const oidc = await verifyGithubOidc((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""));
      if (!oidc) return json(401, { error: "untrusted runner" });
      const body: any = await req.json().catch(() => ({}));
      if (!ID_RE.test(String(body.job_id))) return json(400, { error: "bad job id" });
      // Routing pin: a runner may only claim a job routed to the workflow it runs in.
      const pre = await env.DB.prepare("SELECT operation, params, input_name FROM runtime_jobs WHERE job_id = ?").bind(body.job_id).first();
      if (!pre) return json(409, { error: "job not claimable" });
      let preParams: any = {}; try { preParams = JSON.parse(pre.params || "{}"); } catch { /* empty */ }
      if (pickWorkflow(pre.operation, preParams.source, pre.input_name) !== oidc.workflow) return json(403, { error: "wrong workflow for this job" });
      const sess = crypto.getRandomValues(new Uint8Array(32)).reduce((a, b) => a + b.toString(16).padStart(2, "0"), "");
      const outKey = `d1:${crypto.randomUUID()}`;
      // Single claim: only a dispatched job, and only by one run.
      const row = await env.DB.prepare(
        "UPDATE runtime_jobs SET status = 'running', run_id = ?, session_hash = ?, session_expires = ?, output_key = ?, started_at = ?, stage = 'claimed', updated_at = ? WHERE job_id = ? AND status = 'dispatched' AND (run_id IS NULL OR run_id = ?) RETURNING operation, params, input_name, input_mime, input_size, input_sha256, input_chunks",
      ).bind(oidc.runId, await sha256(sess), new Date(Date.now() + SESSION_TTL_MS).toISOString(), outKey, now(), now(), body.job_id, oidc.runId).first();
      if (!row) return json(409, { error: "job not claimable" });
      return json(200, { session: sess, operation: row.operation, params: JSON.parse(row.params || "{}"), input: row.input_chunks ? { name: row.input_name, mime: row.input_mime, size: row.input_size, sha256: row.input_sha256, chunks: row.input_chunks } : null });
    }
    const job = await session(req, env);
    if (!job) return json(401, { error: "invalid session" });
    if (path === "/runtime/diagnostics" && req.method === "POST") {
      if (job.operation !== "story_generate" && job.operation !== "prompt_generate") return json(403, { error: "diagnostics unavailable for this operation" });
      const raw = await req.text();
      if (enc.encode(raw).byteLength > DIAGNOSTIC_LIMITS.maxEntryBytes + 1024) return json(413, { error: "diagnostic entry too large" });
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return json(400, { error: "invalid diagnostic entry" }); }
      const entry = parseDiagnostic(value);
      if (!entry) return json(400, { error: "invalid diagnostic entry" });
      const evidence = JSON.stringify(entry.evidence);
      const bytes = enc.encode(evidence).byteLength;
      const time = Date.now();
      await env.DB.prepare("DELETE FROM runtime_diagnostics WHERE rowid IN (SELECT rowid FROM runtime_diagnostics WHERE expires_at <= ? LIMIT 64)").bind(time).run();
      // Atomic caps and identity check prevent races from exceeding storage bounds.
      const saved = await env.DB.prepare(
        "INSERT OR IGNORE INTO runtime_diagnostics (job_id,user_id,id,stage,evidence,sha256,bytes,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM runtime_jobs WHERE job_id=? AND user_id=? AND status='running' AND session_hash=?) AND (SELECT COUNT(*) FROM runtime_diagnostics WHERE job_id=?) < ? AND (SELECT COALESCE(SUM(bytes),0) FROM runtime_diagnostics WHERE job_id=?) + ? <= ? RETURNING id",
      ).bind(job.job_id, job.user_id, entry.id, entry.stage, evidence, await sha256(evidence), bytes, time, time + DIAGNOSTIC_LIMITS.retentionMs,
        job.job_id, job.user_id, job.session_hash, job.job_id, DIAGNOSTIC_LIMITS.maxEntries, job.job_id, bytes, DIAGNOSTIC_LIMITS.maxJobBytes).first();
      if (!saved) {
        const previous = await env.DB.prepare("SELECT sha256 FROM runtime_diagnostics WHERE job_id=? AND user_id=? AND id=? AND expires_at>?").bind(job.job_id, job.user_id, entry.id, time).first();
        if (previous?.sha256 === await sha256(evidence)) return json(200, { ok: true, duplicate: true });
        return json(409, { error: "diagnostic storage limit reached or entry conflicts" });
      }
      return json(200, { ok: true, expires_at: time + DIAGNOSTIC_LIMITS.retentionMs });
    }
    const m = path.match(/^\/runtime\/(input|output)\/(\d{1,4})$/);
    if (m && m[1] === "input" && req.method === "GET") {
      const idx = Number(m[2]);
      if (idx >= job.input_chunks) return json(404, { error: "no chunk" });
      const r = await env.DB.prepare("SELECT data FROM artifact_chunks WHERE artifact_key = ? AND idx = ?").bind(job.input_key, idx).first();
      return r ? new Response(r.data, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } }) : json(404, { error: "no chunk" });
    }
    if (m && m[1] === "output" && req.method === "POST") {
      const idx = Number(m[2]);
      if (idx >= MAX_OUTPUT_CHUNKS) return json(413, { error: "output too large" });
      const data = await req.text();
      if (data.length > 1_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return json(400, { error: "bad chunk" });
      await env.DB.prepare("INSERT OR REPLACE INTO artifact_chunks (artifact_key, idx, data) VALUES (?, ?, ?)").bind(job.output_key, idx, data).run();
      return json(200, { ok: true });
    }
    if (path === "/runtime/progress" && req.method === "POST") {
      const b: any = await req.json().catch(() => ({}));
      if (!STAGES.has(b.stage) && !STAGE_RE.test(String(b.stage))) return json(400, { error: "bad stage" });
      await env.DB.prepare("UPDATE runtime_jobs SET stage = ?, updated_at = ? WHERE job_id = ?").bind(b.stage, now(), job.job_id).run();
      return json(200, { ok: true });
    }
    if (path === "/runtime/complete" && req.method === "POST") {
      const b: any = await req.json().catch(() => ({}));
      if (b.ok) {
        const o = b.output;
        const n = Number(o?.chunks);
        if (o && (!Number.isInteger(n) || n < 1 || n > MAX_OUTPUT_CHUNKS || !/^[a-f0-9]{64}$/.test(String(o.sha256)) || !Number.isInteger(o.size))) return json(400, { error: "bad output" });
        await env.DB.prepare("UPDATE runtime_jobs SET status = 'uploaded', session_hash = NULL, output_name = ?, output_mime = ?, output_size = ?, output_sha256 = ?, output_chunks = ?, result = ?, finished_at = ?, updated_at = ? WHERE job_id = ?")
          .bind(o ? String(o.name).slice(0, 120) : null, o ? String(o.mime).slice(0, 80) : null, o?.size ?? null, o?.sha256 ?? null, o ? n : null, JSON.stringify(b.result ?? null).slice(0, 20000), now(), now(), job.job_id).run();
      } else {
        await env.DB.prepare("UPDATE runtime_jobs SET status = 'failed', session_hash = NULL, error = ?, finished_at = ?, updated_at = ? WHERE job_id = ?")
          .bind(String(b.error || "Processing failed").slice(0, 400), now(), now(), job.job_id).run();
      }
      return json(200, { ok: true });
    }
    return json(404, { error: "not found" });
  } catch (e) {
    console.error("[runtime] relay failure", e instanceof Error ? e.name : "UnknownError");
    return json(500, { error: "relay error" });
  }
}
