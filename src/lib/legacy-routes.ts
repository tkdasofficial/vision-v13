// Old page addresses → new ones. Keeps bookmarks and old links working.
// OAuth callbacks, the OTP page (/auth/verify) and API endpoints are not redirected here.
import { notFound, redirect } from "@tanstack/react-router";

const EXACT: Record<string, string> = {
  "/app": "/chat",
  "/app/new": "/chat",
  "/app/incognito": "/chat/incognito",
  "/app/images": "/chat",
  "/studio/images": "/chat",
  "/images": "/chat",
  "/images/": "/chat",
  "/app/videos": "/chat",
  "/studio/videos": "/chat",
  "/videos": "/chat",
  "/videos/": "/chat",
  "/app/library": "/library",
  "/app/projects": "/projects",
  "/app/project-create": "/projects/new",
  "/app/integrations": "/integrations",
  "/app/search": "/search",
  "/app/inbox": "/inbox",
  "/app/account": "/account",
  "/app/prospecting": "/prospecting",
  "/app/upgrade": "/billing/plans",
  "/app/support": "/support",
  "/app/settings": "/settings",
  "/app/settings/appearance": "/settings/appearance",
  "/app/settings/language": "/settings/language",
  "/app/settings/ai-preferences": "/settings/ai",
  "/app/settings/chat-history": "/settings/chat",
  "/app/settings/privacy-data": "/settings/privacy",
  "/app/settings/security": "/settings/security",
  "/app/settings/accessibility": "/settings/accessibility",
  "/app/settings/notifications": "/settings/notifications",
  "/app/settings/about": "/settings/about",
  "/app/settings/reset-password": "/settings/security/password",
  "/auth/signup": "/auth/register",
  "/auth/forget-password": "/auth/forgot-password",
  "/verify": "/auth/login",
  "/verify/confirm-password": "/auth/reset-password",
  "/docs/faq": "/help/faq",
  "/docs/privacy-policy": "/legal/privacy",
  "/docs/terms-conditions": "/legal/terms",
  "/enterprise/email": "/enterprise/login",
};

const DYNAMIC: [RegExp, string][] = [
  [/^\/app\/chat\/([^/]+)$/, "/chat/$1"],
  [/^\/(?:images|videos)\/([^/]+)$/, "/chat/$1"],
  [/^\/app\/doc\/([^/]+)$/, "/documents/$1"],
];

/** New path for an old address, or null when the address isn't a known old page. */
export function legacyTarget(pathname: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (EXACT[p]) return EXACT[p];
  for (const [re, to] of DYNAMIC) if (re.test(p)) return p.replace(re, to);
  return null;
}

export function legacyRedirect(location: { pathname: string; searchStr?: string; hash?: string }): never {
  const to = legacyTarget(location.pathname);
  if (!to) throw notFound();
  const hash = location.hash ? `#${location.hash}` : "";
  throw redirect({ href: `${to}${location.searchStr ?? ""}${hash}`, replace: true, statusCode: 301 });
}
