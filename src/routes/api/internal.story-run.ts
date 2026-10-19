import { createFileRoute } from "@tanstack/react-router";

// Internal: one Cloudflare Queue run of a story job. Only the Worker's queue consumer can call
// this — it adds a marker header carrying the Worker's signing key, and the Worker strips that
// header from every outside request. Returns no story content.
export const Route = createFileRoute("/api/internal/story-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getSecret } = await import("@/lib/ai/runtime-env.server");
        const expected = getSecret("SIGNING_KEY") ?? "";
        const given = request.headers.get("x-vision-queue-token") ?? "";
        if (!expected || !(await sameSecret(given, expected))) return new Response("Not found", { status: 404 });
        const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
        const jobId = typeof body?.jobId === "string" ? body.jobId : "";
        if (!/^[\w-]{8,64}$/.test(jobId)) return Response.json({ ok: false }, { status: 400 });
        const { runQueuedStoryJob } = await import("@/lib/runtime/runtime.server");
        const outcome = await runQueuedStoryJob(jobId);
        console.log(JSON.stringify({ tag: "[story-queue]", jobId, outcome }));
        return Response.json({ ok: true, outcome });
      },
    },
  },
});

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}
