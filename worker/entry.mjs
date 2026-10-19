// Deployed Worker entry for "vision": wraps the built app (dist/server/index.mjs) and adds
// the Cloudflare Queue consumer for story generation. Queue runs get up to 15 minutes, unlike
// request background work, so long story jobs are never cut off mid-generation.
// The consumer hands each message to the app's internal endpoint in-process (no network hop).
// The marker header is stripped from every outside request, so only queue runs can carry it.
import app from "../dist/server/index.mjs";

const QUEUE_HEADER = "x-vision-queue-token";

export default {
  async fetch(request, env, ctx) {
    if (request.headers.has(QUEUE_HEADER)) {
      const headers = new Headers(request.headers);
      headers.delete(QUEUE_HEADER);
      request = new Request(request, { headers });
    }
    return app.fetch(request, env, ctx);
  },

  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      const jobId = msg.body && typeof msg.body.jobId === "string" ? msg.body.jobId : "";
      if (!/^[\w-]{8,64}$/.test(jobId) || !env.SIGNING_KEY) { msg.ack(); continue; }
      try {
        const res = await app.fetch(new Request("https://queue.internal/api/internal/story-run", {
          method: "POST",
          headers: { [QUEUE_HEADER]: env.SIGNING_KEY, "content-type": "application/json" },
          body: JSON.stringify({ jobId }),
        }), env, ctx);
        console.log(JSON.stringify({ tag: "[story-queue:run]", jobId, status: res.status, attempts: msg.attempts }));
        if (res.ok) msg.ack(); else msg.retry({ delaySeconds: 15 });
      } catch (e) {
        console.error(JSON.stringify({ tag: "[story-queue:error]", jobId, error: String(e && e.message || e).slice(0, 300) }));
        msg.retry({ delaySeconds: 15 });
      }
    }
  },
};
