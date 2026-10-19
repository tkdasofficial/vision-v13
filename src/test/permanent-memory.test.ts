// Permanent memory: explicit save detection, relevance selection, scope isolation, honesty on empty.
import { describe, expect, it, vi } from "vitest";
import { detectMemoryRequest, relevantMemories, permanentMemoryBlock, resolveScope, includesPersonal, type PermanentMemory } from "@/lib/ai/memory";

const mem = (id: string, content: string, createdAt = 1): PermanentMemory => ({ id, content, createdAt });

describe("detectMemoryRequest", () => {
  it("detects explicit save requests", () => {
    expect(detectMemoryRequest("Remember that my editor is Neovim")).toEqual({ action: "save", content: "my editor is Neovim" });
    expect(detectMemoryRequest("please remember: I prefer concise answers")).toEqual({ action: "save", content: "I prefer concise answers" });
    expect(detectMemoryRequest("Keep in mind that I live in Kolkata")).toEqual({ action: "save", content: "I live in Kolkata" });
  });
  it("detects recall requests", () => {
    expect(detectMemoryRequest("What do you remember about me?").action).toBe("recall");
    expect(detectMemoryRequest("what did I tell you to remember").action).toBe("recall");
  });
  it("treats ordinary messages as none — no guessing", () => {
    expect(detectMemoryRequest("Write a story about a fox").action).toBe("none");
    expect(detectMemoryRequest("Create a PDF of the story").action).toBe("none");
    expect(detectMemoryRequest("").action).toBe("none");
  });
  it("rejects oversized saves", () => {
    expect(detectMemoryRequest(`remember that ${"x".repeat(600)}`).action).toBe("none");
  });
});

describe("relevantMemories", () => {
  const memories = [
    mem("1", "my editor is Neovim", 1),
    mem("2", "I prefer concise answers", 2),
    mem("3", "my dog is named Bruno", 3),
  ];
  it("always applies saved response preferences as well as matching facts", () => {
    const rel = relevantMemories(memories, "configure my editor for TypeScript");
    expect(rel.map((m) => m.id).sort()).toEqual(["1", "2"]);
  });
  it("returns nothing when nothing matches — never invents", () => {
    expect(relevantMemories(memories, "what is the capital of France").map((m) => m.id)).toEqual(["2"]);
    expect(relevantMemories([], "anything")).toEqual([]);
  });
  it("respects the budget", () => {
    const big = [mem("a", `shared ${ "x".repeat(800)}`), mem("b", `shared ${"y".repeat(800)}`)];
    expect(relevantMemories(big, "shared", 1000)).toHaveLength(1);
  });
});

describe("permanentMemoryBlock", () => {
  it("is empty without memories (no fabricated recall)", () => {
    expect(permanentMemoryBlock([])).toBe("");
  });
  it("states current message wins on conflicts and fences content", () => {
    const block = permanentMemoryBlock([mem("1", "I prefer concise answers")]);
    expect(block).toContain("current message wins on conflicts");
    expect(block).toContain("I prefer concise answers");
    expect(block).toContain('source="permanent-memory"');
  });
});

describe("scope isolation", () => {
  it("project scope excludes personal (permanent) memory; default and none include it", () => {
    expect(includesPersonal(resolveScope("p1", "project"))).toBe(false);
    expect(includesPersonal(resolveScope("p1", "default"))).toBe(true);
    expect(includesPersonal(resolveScope(null, null))).toBe(true);
  });
});

describe("memory persistence failure", () => {
  it("fails soft: save returns null and load returns [] when the database is unreachable", async () => {
    vi.doMock("@/lib/cloud/d1.server", () => ({ d1: async () => { throw new Error("Database request failed"); } }));
    const { savePermanentMemory, loadPermanentMemories } = await import("@/lib/ai/memory.server");
    expect(await savePermanentMemory("u1", "my favorite color is teal")).toBeNull();
    expect(await loadPermanentMemories("u1")).toEqual([]);
    vi.doUnmock("@/lib/cloud/d1.server");
  });
});
