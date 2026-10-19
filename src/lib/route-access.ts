// Single source of truth for who may open which page. Used by the root RouteGuard.
// Browser-side only decides what to *show*; every server function and API route
// still checks the session itself.

export type Access = "public" | "guest" | "protected" | "recovery";

export const HOME_PATH = "/chat";
export const LOGIN_PATH = "/auth/login";

/** Sign-in pages: signed-in users are sent to the main screen. */
const GUEST = ["/auth/login", "/auth/register", "/auth/forgot-password"];
/** Recovery flows keyed by their own short-lived ticket, open with or without a session. */
const RECOVERY = ["/auth/reset-password"];
/** Signed-in-only areas (prefix match). */
const PROTECTED = [
  "/chat", "/drawer", "/images", "/videos", "/studio", "/library", "/projects", "/integrations", "/search", "/inbox", "/account",
  "/prospecting", "/documents", "/billing", "/support", "/settings",
  "/admin", "/getting-started", "/enterprise/getting-started",
  "/app", // legacy addresses; they redirect to the paths above
];

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";
const under = (p: string, base: string) => p === base || p.startsWith(base + "/");

export function classifyRoute(pathname: string): Access {
  const p = norm(pathname.split("?")[0].split("#")[0]);
  if (GUEST.includes(p)) return "guest";
  if (RECOVERY.includes(p)) return "recovery";
  if (PROTECTED.some((b) => under(p, b))) return "protected";
  // Legal pages, FAQ, email verification, enterprise sign-in, OAuth callbacks, 404s.
  return "public";
}

/** Only same-site, signed-in destinations are accepted as a post-login return path. */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return HOME_PATH;
  return classifyRoute(raw) === "protected" ? raw : HOME_PATH;
}

export function loginPathFor(returnTo: string): string {
  return returnTo && classifyRoute(returnTo) === "protected" && returnTo !== HOME_PATH
    ? `${LOGIN_PATH}?redirect=${encodeURIComponent(returnTo)}`
    : LOGIN_PATH;
}

/** Where to go after a successful sign-in on the current page. */
export function postLoginPath(): string {
  if (typeof window === "undefined") return HOME_PATH;
  return safeReturnPath(new URLSearchParams(window.location.search).get("redirect"));
}
