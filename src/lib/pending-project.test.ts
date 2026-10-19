import { describe, it, expect } from "vitest";
import { setPendingProject, takePendingProject, sortProjects } from "./pending-project";

describe("pending project", () => {
  it("is used by exactly one new chat", () => {
    setPendingProject("p1");
    expect(takePendingProject()).toBe("p1");
    expect(takePendingProject()).toBeNull();
  });
  it("puts pinned projects first", () => {
    const list = [{ id: "a", updated_at: "2026-02" }, { id: "b", pinned: 1, updated_at: "2026-01" }];
    expect(sortProjects(list).map((p) => p.id)).toEqual(["b", "a"]);
  });
});
