import { createFileRoute } from "@tanstack/react-router";

// Internal: scheduled vision-sandbox maintenance (expire stalled jobs, delete due workspaces).
// Only the Worker's cron handler can call this — same marker-header scheme as story-run.
export const Route = createFileRoute("/api/internal/sandbox-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getSecret } = await import("@/lib/ai/runtime-env.server");
        const expected = getSecret("SIGNING_KEY") ?? "";
        const given = request.headers.get("x-vision-queue-token") ?? "";
        if (!expected || !(await same(given, expected))) return new Response("Not found", { status: 404 });
        const { sandboxDb, sandboxReady } = await import("@/lib/sandbox/db.server");
        if (!sandboxReady()) return Response.json({ ok: false }, { status: 503 });
        const { expireStalled, runCleanup } = await import("@/lib/sandbox/workspace");
        const expired = await expireStalled(sandboxDb);
        const cleaned = await runCleanup(sandboxDb);
        return Response.json({ ok: true, expired, cleaned });
      },
    },
  },
});

async function same(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i];
  return d === 0;
}
