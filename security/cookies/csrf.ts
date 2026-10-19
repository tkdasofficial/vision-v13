// CSRF protection for state-changing auth requests (complements SameSite=Lax session cookies).
import type { RequestFacts } from "../types";

export function isSameOriginRequest(req: RequestFacts, extraAllowedOrigins: string[] = []): boolean {
  // Sec-Fetch-Site is set by the browser and cannot be forged by a web page; prefer it.
  if (req.secFetchSite) return req.secFetchSite !== "cross-site";
  if (!req.origin) return true; // non-browser or same-origin navigations without Origin
  try {
    const o = new URL(req.origin);
    if (req.host && o.host === req.host) return true;
    return extraAllowedOrigins.some((a) => { try { return new URL(a).host === o.host; } catch { return false; } });
  } catch {
    return false;
  }
}

// SameSite=None + Partitioned so sign-in persists inside embedded previews; cross-site writes are still blocked by isSameOriginRequest.
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" };
