import { createFileRoute } from "@tanstack/react-router";

// One job: read status (with stale recovery), cancel, or retry with the same input.
export const Route = createFileRoute("/api/jobs/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const { getJob } = await import("@/lib/jobs/jobs.server");
        const job = await getJob(caller.user.id, params.jobId);
        if (!job) return Response.json({ error: "Not found." }, { status: 404 });
        if (new URL(request.url).searchParams.get("diagnostics") === "1") {
          const { readRuntimeDiagnostics } = await import("@/lib/runtime/diagnostics.server");
          const diagnostics = await readRuntimeDiagnostics(caller.user.id, params.jobId);
          return Response.json({ diagnostics }, { headers: { "Cache-Control": "no-store" } });
        }
        return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request, params }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const { factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
        try { assertSameOrigin(factsFrom(request.headers, null)); } catch (e: any) { return Response.json({ error: e.message }, { status: 403 }); }
        const body: any = await request.json().catch(() => ({}));
        const jobs = await import("@/lib/jobs/jobs.server");
        if (body.action === "cancel") {
          const ok = await jobs.requestCancel(caller.user.id, params.jobId);
          return Response.json({ ok }, { status: ok ? 200 : 409 });
        }
        if (body.action === "retry") {
          if (!jobs.ID_RE.test(String(body.newId))) return Response.json({ error: "Invalid job id." }, { status: 400 });
          const prev = await jobs.getJobInput(caller.user.id, params.jobId);
          if (!prev) return Response.json({ error: "Not found." }, { status: 404 });
          if (prev.status !== "failed" && prev.status !== "cancelled" && prev.status !== "timed_out") return Response.json({ error: "Only failed or cancelled tasks can be retried." }, { status: 409 });
          if (prev.attempt >= 5) return Response.json({ error: "Retry limit reached." }, { status: 429 });
          const { startJob } = await import("@/lib/jobs/dispatch.server");
          const job = await startJob(caller.user.id, body.newId, prev.type, prev.type === "agent_task" ? { ...prev.input, resumeFrom: params.jobId } : prev.input, prev.attempt + 1, prev.sessionId);
          return Response.json({ job });
        }
        return Response.json({ error: "Unknown action." }, { status: 400 });
      },
    },
  },
});
