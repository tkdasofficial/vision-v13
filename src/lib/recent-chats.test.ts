import { describe, it, expect } from "vitest";
import { recentChats, projectChats } from "./recent-chats";
describe("recentChats", () => {
  it("hides chats that belong to a project", () => {
    expect(recentChats([{ id: "a", projectId: "p1" }, { id: "b" }]).map((c) => c.id)).toEqual(["b"]);
  });
  it("puts pinned chats first", () => {
    expect(recentChats([{ id: "a" }, { id: "b", pinned: true }]).map((c) => c.id)).toEqual(["b", "a"]);
  });
  it("returns removed project chats to their creation-time position", () => {
    const chats = [{ id: "old", createdAt: 100, projectId: "p1" }, { id: "new", createdAt: 300 }, { id: "middle", createdAt: 200 }];
    const moved = chats.map((c) => c.id === "old" ? { ...c, projectId: null } : c);
    expect(recentChats(moved).map((c) => c.id)).toEqual(["new", "middle", "old"]);
    expect(moved[0].createdAt).toBe(100);
  });
  it("moves default chats into only their project in creation-time order", () => {
    const moved = [{ id: "middle", createdAt: 200, projectId: "p1" }, { id: "old", createdAt: 100, projectId: "p1" }, { id: "new", createdAt: 300, projectId: "p1" }, { id: "other", createdAt: 400, projectId: "p2" }, { id: "default", createdAt: 500 }];
    expect(projectChats(moved, "p1").map((c) => c.id)).toEqual(["new", "middle", "old"]);
    expect(recentChats(moved).map((c) => c.id)).toEqual(["default"]);
  });
  it("keeps pinned project chats ahead of newer unpinned chats", () => {
    expect(projectChats([{ id: "new", projectId: "p1", createdAt: 300 }, { id: "pinned", projectId: "p1", createdAt: 100, pinned: true }], "p1").map((c) => c.id)).toEqual(["pinned", "new"]);
  });
});
