import { createFileRoute } from "@tanstack/react-router";

const TYPES = ["code_export", "project_generate", "zip_analyze", "agent_task", "long_context", "runtime_task"] as const;
const MAX_AGENT_FILES = 10, MAX_AGENT_BYTES = 25 * 1024 * 1024;

// Jobs API: list the caller's jobs, or start one (JSON for code/projects, multipart for ZIP uploads).
export const Route = createFileRoute("/api/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const { listJobs } = await import("@/lib/jobs/jobs.server");
        const session = new URL(request.url).searchParams.get("session");
        const sid = session && /^[\w-]{1,64}$/.test(session) ? session : undefined;
        return Response.json({ jobs: await listJobs(caller.user.id, 30, sid) }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        {
          const { d1Store, factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
          const { enforceLimits, SECURITY_CONFIG } = await import("../../../security");
          try { assertSameOrigin(factsFrom(request.headers, null)); } catch (e: any) { return Response.json({ error: e.message }, { status: 403 }); }
          try { await enforceLimits(d1Store, [[`jobs:user:${caller.user.id}`, SECURITY_CONFIG.limits.chatPerUser]]); }
          catch (e: any) { return Response.json({ error: e.message }, { status: 429 }); }
        }
        const { ID_RE } = await import("@/lib/jobs/jobs.server");
        const { startJob } = await import("@/lib/jobs/dispatch.server");
        const ct = request.headers.get("content-type") ?? "";
        if (ct.includes("multipart/form-data")) {
          const form = await request.formData().catch(() => null);
          const file = form?.get("file");
          const id = String(form?.get("id") ?? "");
          const sessionId = sessionOf(form?.get("sessionId"));
          if (!ID_RE.test(id)) return Response.json({ error: "Invalid job id." }, { status: 400 });
          if (form?.get("type") === "agent_task") {
            const files = (form.getAll("file").filter((f) => f instanceof File) as File[]);
             const prompt = String(form.get("prompt") ?? "");
             if (prompt.length > 80000) return Response.json({ error: "The referenced content is too large for this task." }, { status: 413 });
            if (!prompt.trim() && !files.length) return Response.json({ error: "Tell me what to do." }, { status: 400 });
            if (files.length > MAX_AGENT_FILES) return Response.json({ error: `Up to ${MAX_AGENT_FILES} files at a time.` }, { status: 413 });
            if (files.reduce((n, f) => n + f.size, 0) > MAX_AGENT_BYTES) return Response.json({ error: "Attached files can total up to 25 MB." }, { status: 413 });
            const { detectRuntimeOp } = await import("@/lib/runtime/operations");
            const rq = detectRuntimeOp(prompt, files.map((f) => ({ name: f.name, mime: f.type || "", size: f.size })));
            if (rq && "error" in rq) return Response.json({ error: rq.error }, { status: 400 });
            if (rq) {
              const f = files[rq.fileIndex];
              const job = await startJob(caller.user.id, id, "runtime_task", { operation: rq.operation, params: rq.params, fileName: f.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "file", mime: (f.type || "application/octet-stream").slice(0, 100), bytes: new Uint8Array(await f.arrayBuffer()) }, 1, sessionId);
              return Response.json({ job });
            }
            const list = await Promise.all(files.map(async (f) => ({ name: f.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "file", mime: (f.type || "application/octet-stream").slice(0, 100), bytes: new Uint8Array(await f.arrayBuffer()) })));
            const job = await startJob(caller.user.id, id, "agent_task", { prompt: prompt || "Inspect these files.", files: list }, 1, sessionId);
            return Response.json({ job });
          }
          if (!(file instanceof File)) return Response.json({ error: "No file provided." }, { status: 400 });
          if (file.size > 25 * 1024 * 1024) return Response.json({ error: "ZIP files up to 25 MB are supported." }, { status: 413 });
          if (!/\.zip$/i.test(file.name)) return Response.json({ error: "Please upload a .zip file." }, { status: 400 });
          const job = await startJob(caller.user.id, id, "zip_analyze", { fileName: file.name.slice(0, 120), bytes: new Uint8Array(await file.arrayBuffer()) }, 1, sessionId);
          return Response.json({ job });
        }
        const body: any = await request.json().catch(() => null);
        if (!body || !ID_RE.test(String(body.id)) || !TYPES.includes(body.type) || body.type === "zip_analyze") return Response.json({ error: "Invalid request." }, { status: 400 });
        const i = body.input ?? {};
        if (typeof i.prompt === "string" && i.prompt.length > 80000) return Response.json({ error: "The referenced content is too large for this task." }, { status: 413 });
        // Prompt-only background operations (story generation) arrive as JSON without a file.
        if (body.type === "runtime_task") {
          if (i.operation !== "story_generate" && i.operation !== "prompt_generate") return Response.json({ error: "Invalid request." }, { status: 400 });
          const prompt = str(i.params?.prompt, 60000);
          if (!prompt?.trim()) return Response.json({ error: "Tell me what to write." }, { status: 400 });
          try {
            const job = await startJob(caller.user.id, body.id, "runtime_task", i.operation === "prompt_generate" ? { operation: "prompt_generate", params: { prompt }, fileName: "prompts.md", mime: "text/markdown" } : { operation: "story_generate", params: { prompt }, fileName: "story.md", mime: "text/markdown" }, 1, sessionOf(body.sessionId));
            return Response.json({ job });
          } catch (e: any) {
            return Response.json({ error: /UNIQUE/i.test(String(e?.message)) ? "This task already exists." : "Could not start the task." }, { status: 409 });
          }
        }
        const input = body.type === "agent_task" || body.type === "long_context" ? { prompt: str(i.prompt, 80000) ?? "" } : body.type === "code_export"
          ? { prompt: str(i.prompt, 8000), language: str(i.language, 30), filename: str(i.filename, 120), code: str(i.code, 500_000) }
          : { prompt: str(i.prompt, 8000) ?? "", stack: str(i.stack, 30), name: str(i.name, 60) };
        try {
          const job = await startJob(caller.user.id, body.id, body.type, input, 1, sessionOf(body.sessionId));
          return Response.json({ job });
        } catch (e: any) {
          return Response.json({ error: /UNIQUE/i.test(String(e?.message)) ? "This task already exists." : "Could not start the task." }, { status: 409 });
        }
      },
    },
  },
});

function sessionOf(v: unknown): string | null {
  return typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : null;
}

function str(v: unknown, max: number): any {
  return typeof v === "string" && v.length ? v.slice(0, max) : undefined;
}
