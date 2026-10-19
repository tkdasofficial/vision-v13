import { createFileRoute } from "@tanstack/react-router";

const ID_RE = /^[\w-]{8,64}$/;

// Long Context Generation job API: status, chunks, output, events, retry, resume, cancel.
export const Route = createFileRoute("/api/sandbox-generations/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        if (!ID_RE.test(params.jobId)) return Response.json({ error: "Invalid job." }, { status: 400 });
        const store = await import("@/lib/sandbox/store.server");
        const job = await store.getJob(caller.user.id, params.jobId);
        if (!job) return Response.json({ error: "Not found." }, { status: 404 });
        const view = new URL(request.url).searchParams.get("view") ?? "status";
        if (view === "chunks") return Response.json({ chunks: await store.listChunks(caller.user.id, params.jobId) }, { headers: { "Cache-Control": "no-store" } });
        if (view === "output") {
          const output = await store.latestOutput(caller.user.id, params.jobId);
          if (!output) return Response.json({ error: "No output yet." }, { status: 404 });
          return Response.json({ output }, { headers: { "Cache-Control": "no-store" } });
        }
        if (view === "events") return Response.json({ events: await store.listEvents(caller.user.id, params.jobId) }, { headers: { "Cache-Control": "no-store" } });
        return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
      },
      POST: async ({ request, params }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        if (!ID_RE.test(params.jobId)) return Response.json({ error: "Invalid job." }, { status: 400 });
        {
          const { factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
          try { assertSameOrigin(factsFrom(request.headers, null)); } catch (e: any) { return Response.json({ error: e.message }, { status: 403 }); }
        }
        const body: any = await request.json().catch(() => ({}));
        const action = body?.action;
        const store = await import("@/lib/sandbox/store.server");
        const job = await store.getJob(caller.user.id, params.jobId);
        if (!job) return Response.json({ error: "Not found." }, { status: 404 });
        const runner = await import("@/lib/sandbox/runner.server");
        if (action === "cancel") {
          const ok = await runner.cancelJob(caller.user.id, params.jobId);
          return Response.json({ ok });
        }
        if (action === "retry" || action === "resume") {
          const { prepareKeepAlive } = await import("@/lib/jobs/chat-background.server");
          const keepAlive = await prepareKeepAlive();
          const promise = runner.retryJob(caller.user.id, params.jobId).catch((e) => console.error("[sandbox] retry failed", (e as Error)?.message));
          keepAlive(promise);
          return Response.json({ ok: true }, { status: 202 });
        }
        return Response.json({ error: "Unknown action." }, { status: 400 });
      },
    },
  },
});
