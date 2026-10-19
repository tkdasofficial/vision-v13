/**
 * The only place the offline service worker is registered.
 * Refuses (and removes any old copy) in dev, inside iframes, on Lovable preview hosts, and with ?sw=off.
 */
const SW_URL = "/sw.js";

export function isRefusedContext(loc: { hostname: string; search: string }, inIframe: boolean, prod: boolean): boolean {
  const h = loc.hostname;
  if (!prod || inIframe) return true;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  if (/(^|\.)lovableproject(-dev)?\.com$/.test(h) || /(^|\.)beta\.lovable\.dev$/.test(h)) return true;
  return new URLSearchParams(loc.search).has("sw") && new URLSearchParams(loc.search).get("sw") === "off";
}

async function unregisterAppWorkers() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs.filter((r) => [r.active, r.waiting, r.installing].some((w) => w?.scriptURL.endsWith(SW_URL))).map((r) => r.unregister()),
  );
}

/** Ask the browser not to evict our storage. Browsers may still refuse or clear it. */
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.();
  } catch { /* unsupported */ }
}

export function setupPwa() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  let inIframe = true;
  try { inIframe = window.self !== window.top; } catch { /* cross-origin parent */ }
  if (isRefusedContext(window.location, inIframe, import.meta.env.PROD)) {
    void unregisterAppWorkers().catch(() => {});
    return;
  }
  void requestPersistentStorage();
  navigator.serviceWorker
    .register(SW_URL, { scope: "/" })
    .then((reg) => {
      // Look for a new deployment when the tab regains focus and hourly.
      const check = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      setInterval(check, 60 * 60_000);
    })
    .catch(() => { /* app keeps working without the cache */ });
}
