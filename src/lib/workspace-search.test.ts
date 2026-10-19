import { describe, expect, it } from "vitest";
import { collectSearchItems } from "./workspace-search";
describe("Recent search isolation", () => {
  it("excludes project chats from global Recent search", () => {
    const result = collectSearchItems([{ id: "project-chat", project_id: "p1" }, { id: "default-chat", project_id: null }], [], [], []);
    expect(result.filter((item) => item.category === "chats").map((item) => item.id)).toEqual(["default-chat"]);
  });
});