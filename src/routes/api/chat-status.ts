import { createFileRoute } from "@tanstack/react-router";

// Live state of the latest reply generation in one of the caller's chats (used to reconnect after a reload).
export const Route = createFileRoute("/api/chat-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const url = new URL(request.url);
        const chatId = url.searchParams.get("chat") ?? "";
        if (!/^[\w-]{8,64}$/.test(chatId)) return Response.json({ error: "Invalid chat." }, { status: 400 });
        const { latestGeneration } = await import("@/lib/ai/generation-store.server");
        try {
          const generation = await latestGeneration(caller.user.id, { chatId });
          return Response.json({ generation }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ error: "Status unavailable." }, { status: 503 });
        }
      },
    },
  },
});
