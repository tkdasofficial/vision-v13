import { createFileRoute } from "@tanstack/react-router";

// Settings → Memory: list, edit and delete the caller's saved memories (owner-scoped in SQL).
async function guard(request: Request, write: boolean) {
  const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
  const proxied = await maybeProxyToWorker(request);
  if (proxied) return { res: proxied };
  const { getCaller } = await import("@/lib/cloud/auth.server");
  const caller = await getCaller();
  if (!caller) return { res: Response.json({ error: "Please sign in." }, { status: 401 }) };
  if (write) {
    const { factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
    try { assertSameOrigin(factsFrom(request.headers, null)); } catch (e: any) { return { res: Response.json({ error: e.message }, { status: 403 }) }; }
  }
  return { userId: caller.user.id as string };
}
const ID = /^[\w-]{1,64}$/;
const noStore = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/memories")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const g = await guard(request, false);
        if (g.res) return g.res;
        const { listMemoryItems } = await import("@/lib/ai/memory.server");
        if (!g.userId) return Response.json({ error: "Please sign in." }, { status: 401 });
        const items = await listMemoryItems(g.userId);
        if (!items) return Response.json({ error: "Couldn't load memories. Try again." }, { status: 503 });
        return Response.json({ memories: items }, { headers: noStore });
      },
      PATCH: async ({ request }) => {
        const g = await guard(request, true);
        if (g.res) return g.res;
        if (!g.userId) return Response.json({ error: "Please sign in." }, { status: 401 });
        const body: any = await request.json().catch(() => ({}));
        if (body?.switches && typeof body.switches === "object") {
          const patch: { savedMemories?: boolean; chatHistory?: boolean } = {};
          for (const key of ["savedMemories", "chatHistory"] as const) {
            if (body.switches[key] !== undefined) {
              if (typeof body.switches[key] !== "boolean") return Response.json({ error: "Invalid memory setting." }, { status: 400 });
              patch[key] = body.switches[key];
            }
          }
          if (!Object.keys(patch).length) return Response.json({ error: "No memory setting supplied." }, { status: 400 });
          const { setMemorySwitches, loadChatContext } = await import("@/lib/ai/memory.server");
          if (!await setMemorySwitches(g.userId, patch)) return Response.json({ error: "Couldn't save memory settings." }, { status: 503 });
          const { parsePrefs } = await import("@/lib/settings");
          return Response.json({ prefs: parsePrefs((await loadChatContext(g.userId, undefined)).prefsRaw) }, { headers: noStore });
        }
        if (!ID.test(String(body?.id ?? "")) || typeof body?.content !== "string") return Response.json({ error: "Invalid memory." }, { status: 400 });
        const { editMemory } = await import("@/lib/ai/memory.server");
        const ok = await editMemory(g.userId, body.id, body.content);
        return ok ? Response.json({ ok: true }) : Response.json({ error: "Couldn't save this memory." }, { status: 400 });
      },
      DELETE: async ({ request }) => {
        const g = await guard(request, true);
        if (g.res) return g.res;
        if (!g.userId) return Response.json({ error: "Please sign in." }, { status: 401 });
        const body: any = await request.json().catch(() => ({}));
        const ids = body?.all === true ? "all" : Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string" && ID.test(x)).slice(0, 100) : [];
        if (ids !== "all" && !ids.length) return Response.json({ error: "Nothing to delete." }, { status: 400 });
        const { deletePermanentMemories } = await import("@/lib/ai/memory.server");
        const n = await deletePermanentMemories(g.userId, ids);
        return n === null ? Response.json({ error: "Couldn't delete. Try again." }, { status: 503 }) : Response.json({ deleted: n });
      },
    },
  },
});
