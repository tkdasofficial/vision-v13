import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { legacyTarget } from "@/lib/legacy-routes";

// Match routes without running loaders or rendering.
const match = (path: string) =>
  createRouter({ routeTree, context: { queryClient: new QueryClient() } }).matchRoutes(path).at(-1);

describe("App routing", () => {
  it.each([
    ["/chat", "/chat/"],
    ["/chat/abc123", "/chat/$chatId"],
    ["/chat/incognito", "/chat/incognito"],
    ["/images", "/images/"],
    ["/images/i1", "/images/$imageChatId"],
    ["/videos", "/videos/"],
    ["/videos/v1", "/videos/$videoChatId"],
    ["/library", "/library"],
    ["/projects", "/projects/"],
    ["/projects/new", "/projects/new"],
    ["/integrations", "/integrations"],
    ["/search", "/search"],
    ["/drawer", "/drawer"],
    ["/inbox", "/inbox"],
    ["/account", "/account"],
    ["/prospecting", "/prospecting"],
    ["/documents/d1", "/documents/$docId"],
    ["/billing/plans", "/billing/plans"],
    ["/support", "/support"],
    ["/help/faq", "/help/faq"],
    ["/legal/privacy", "/legal/privacy"],
    ["/legal/terms", "/legal/terms"],
    ["/settings", "/settings/"],
    ["/settings/ai", "/settings/ai"],
    ["/settings/chat", "/settings/chat"],
    ["/settings/privacy", "/settings/privacy"],
    ["/settings/security", "/settings/security/"],
    ["/settings/security/password", "/settings/security/password"],
    ["/auth/register", "/auth/register"],
    ["/auth/forgot-password", "/auth/forgot-password"],
    ["/auth/verify", "/auth/verify"],
    ["/auth/reset-password", "/auth/reset-password"],
    ["/enterprise/login", "/enterprise/login"],
    ["/admin/users", "/admin/users"],
  ])("%s opens %s", (path, id) => {
    expect(match(path)?.routeId).toBe(id);
  });
  it("matches a page for / instead of falling back to not found", () => {
    expect(match("/")?.routeId).not.toBe(rootRouteId);
  });
});

describe("legacy addresses", () => {
  it.each([
    ["/app/new", "/chat"],
    ["/studio/images", "/chat"],
    ["/studio/videos", "/chat"],
    ["/images", "/chat"],
    ["/videos/v1", "/chat/v1"],
    ["/app/chat/abc", "/chat/abc"],
    ["/app/doc/d1", "/documents/d1"],
    ["/app/incognito", "/chat/incognito"],
    ["/app/project-create", "/projects/new"],
    ["/app/upgrade", "/billing/plans"],
    ["/app/settings/", "/settings"],
    ["/app/settings/ai-preferences", "/settings/ai"],
    ["/app/settings/reset-password", "/settings/security/password"],
    ["/auth/signup", "/auth/register"],
    ["/auth/forget-password", "/auth/forgot-password"],
    ["/verify/confirm-password", "/auth/reset-password"],
    ["/docs/faq", "/help/faq"],
    ["/docs/terms-conditions", "/legal/terms"],
    ["/enterprise/email", "/enterprise/login"],
  ])("%s → %s", (from, to) => expect(legacyTarget(from)).toBe(to));
  it("leaves unknown and non-page addresses alone", () => {
    for (const p of ["/app/nope", "/auth/verify", "/api/oauth/google", "/google/callback"]) expect(legacyTarget(p)).toBeNull();
  });
});
