import { createFileRoute } from "@tanstack/react-router";

const ID_RE = /^[\w-]{8,64}$/;

// Long Context Generation API (vision-sandbox): create a job or list the caller's jobs.
export const Route = createFileRoute("/api/sandbox-generations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const { sandboxDb, sandboxReady } = await import("@/lib/sandbox/db.server");
        if (!sandboxReady()) return Response.json({ error: "Generation store unavailable." }, { status: 503 });
        const jobs = await sandboxDb("SELECT id, status, total_chunks, completed_chunks, error, created_at, updated_at FROM generation_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 30", [caller.user.id]);
        return Response.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
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
          try { await enforceLimits(d1Store, [[`sandbox:user:${caller.user.id}`, SECURITY_CONFIG.limits.chatPerUser]]); }
          catch (e: any) { return Response.json({ error: e.message }, { status: 429 }); }
        }
        const body: any = await request.json().catch(() => null);
        const instructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
        if (instructions.length < 3 || instructions.length > 20_000) return Response.json({ error: "Instructions must be 3-20000 characters." }, { status: 400 });
        const requestId = typeof body?.requestId === "string" && ID_RE.test(body.requestId) ? body.requestId : undefined;
        const { sandboxReady } = await import("@/lib/sandbox/db.server");
        if (!sandboxReady()) return Response.json({ error: "Generation store unavailable." }, { status: 503 });
        const { createJob } = await import("@/lib/sandbox/store.server");
        const { prepareKeepAlive } = await import("@/lib/jobs/chat-background.server");
        const keepAlive = await prepareKeepAlive();
        const job = await createJob(caller.user.id, { instructions, modelConfig: body?.modelConfig, settings: body?.settings, requestId });
        // Run detached: the caller polls for status; a reload never duplicates the job.
        const { runJob } = await import("@/lib/sandbox/runner.server");
        const promise = runJob(caller.user.id, job.id).catch((e) => console.error("[sandbox] run failed", (e as Error)?.message));
        keepAlive(promise);
        return Response.json({ job }, { status: 202, headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
