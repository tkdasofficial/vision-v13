/**
 * Loads the code for every main page once, quietly, after the first screen is ready,
 * so moving between pages is instant. Only page code is loaded — no data is fetched;
 * live data still loads when a page opens. The service worker keeps these files
 * cached on disk between visits (see src/lib/pwa.ts).
 */
export const WARM_ROUTES = [
  "/",
  "/chat",
  "/drawer",
  "/search",
  "/library",
  "/projects",
  "/integrations",
  "/settings",
  "/settings/about",
  "/settings/accessibility",
  "/settings/ai",
  "/settings/appearance",
  "/settings/chat",
  "/settings/language",
  "/settings/notifications",
  "/settings/privacy",
  "/settings/security",
  "/settings/security/password",
] as const;

type ChunkRouter = {
  routesByPath: Record<string, unknown>;
  loadRouteChunk: (route: never) => Promise<unknown>;
};

export function warmRoutes(router: ChunkRouter) {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  const run = async () => {
    for (const path of WARM_ROUTES) {
      if (cancelled) return;
      const route = router.routesByPath[path] ?? router.routesByPath[`${path}/`];
      if (!route) continue;
      try { await router.loadRouteChunk(route as never); } catch { /* offline or chunk missing — loads on demand */ }
    }
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  const id = w.requestIdleCallback ? w.requestIdleCallback(() => void run()) : window.setTimeout(() => void run(), 1500);
  return () => { cancelled = true; if (!w.requestIdleCallback) clearTimeout(id); };
}
