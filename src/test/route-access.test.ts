import { describe, it, expect } from "vitest";
import { classifyRoute, safeReturnPath, loginPathFor } from "@/lib/route-access";

describe("route access rules", () => {
  it("classifies guest-only sign-in pages", () => {
    for (const p of ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/login/"]) expect(classifyRoute(p)).toBe("guest");
  });
  it("keeps legal, FAQ, verification and enterprise sign-in pages public", () => {
    for (const p of ["/legal/privacy", "/legal/terms", "/help/faq", "/auth/verify", "/enterprise", "/enterprise/login", "/enterprise/verify", "/auth/google/callback", "/nope"]) expect(classifyRoute(p)).toBe("public");
  });
  it("treats the set-new-password step as recovery", () => {
    expect(classifyRoute("/auth/reset-password")).toBe("recovery");
  });
  it("protects app, settings, account, admin and onboarding", () => {
    for (const p of ["/chat", "/chat/x", "/chat/incognito", "/settings", "/settings/security", "/settings/security/password", "/account", "/support", "/documents/d1", "/projects/new", "/studio/images", "/billing/plans", "/admin", "/admin/users", "/getting-started", "/enterprise/getting-started", "/app/new"]) expect(classifyRoute(p)).toBe("protected");
    expect(classifyRoute("/chatter")).toBe("public");
  });
  it("only accepts same-site protected return paths", () => {
    expect(safeReturnPath("/account")).toBe("/account");
    for (const bad of ["//evil.com", "https://evil.com", "/auth/login", "/\\evil", null]) expect(safeReturnPath(bad as any)).toBe("/chat");
    expect(loginPathFor("/account")).toBe("/auth/login?redirect=%2Faccount");
    expect(loginPathFor("/chat")).toBe("/auth/login");
  });
});
