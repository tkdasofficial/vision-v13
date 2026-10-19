import { describe, expect, it } from "vitest";
import { closeTarget } from "@/lib/navigation-motion";

describe("closing pages returns to Chat", () => {
  it("Library/Plugins/Settings back lands on Chat with the drawer open", () => {
    for (const p of ["/library", "/integrations", "/settings"]) {
      expect(closeTarget(p, -1)).toEqual({ state: { __visionOpenDrawer: true }, direction: "to-left" });
      expect(closeTarget(p, "/drawer")?.state.__visionOpenDrawer).toBe(true);
    }
  });
  it("Projects back lands on plain Chat", () => {
    expect(closeTarget("/projects", -1)).toEqual({ state: {}, direction: "back" });
  });
  it("a project's back reopens the Projects panel", () => {
    expect(closeTarget("/projects/abc", "/projects")?.state.__visionOpenProjects).toBe(true);
  });
  it("other pages keep normal history", () => {
    expect(closeTarget("/settings/ai", -1)).toBeNull();
    expect(closeTarget("/chat", -1)).toBeNull();
  });
});
