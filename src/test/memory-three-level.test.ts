// Three-level memory: permanent lifecycle (save/update/delete/ambiguity), chat isolation, project scope, failures.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  detectMemoryCommand, planMemoryWrite, matchForget, detectAutoMemory, memorySubject,
  rankProjectRows, projectRowsBlock, relevantMemories, type PermanentMemory, type ProjectRow,
} from "@/lib/ai/memory";

const mem = (id: string, content: string, createdAt = 1): PermanentMemory => ({ id, content, createdAt });

describe("memory commands", () => {
  it("detects forget, delete-from-memory and forget-all", () => {
    expect(detectMemoryCommand("Forget that my favorite color is teal")).toEqual({ action: "forget", query: "my favorite color is teal" });
    expect(detectMemoryCommand("Delete my dog's name from your memory")).toEqual({ action: "forget", query: "my dog's name" });
    expect(detectMemoryCommand("Forget all your memories").action).toBe("forget_all");
    expect(detectMemoryCommand("forget everything you know about me").action).toBe("forget_all");
  });
  it("conversational 'forget it' is not a memory deletion", () => {
    expect(detectMemoryCommand("Forget it, write a poem instead").action).toBe("none");
    expect(detectMemoryCommand("Delete the file").action).toBe("none");
  });
  it("update phrasing saves (and replaces by subject)", () => {
    expect(detectMemoryCommand("Update your memory: my favorite color is blue")).toEqual({ action: "save", content: "my favorite color is blue" });
    expect(detectMemoryCommand("Remember that my favorite color is teal")).toEqual({ action: "save", content: "my favorite color is teal" });
  });
});

describe("planMemoryWrite — updates and conflicts", () => {
  const existing = [mem("a", "my favorite color is teal"), mem("b", "my dog is named Bruno")];
  it("same subject replaces the outdated fact, leaving others alone", () => {
    expect(planMemoryWrite(existing, "My favorite color is blue")).toEqual({ kind: "replace", id: "a", previous: "my favorite color is teal" });
  });
  it("exact duplicate is a no-op", () => {
    expect(planMemoryWrite(existing, "My dog is named Bruno")).toEqual({ kind: "duplicate", id: "b" });
  });
  it("unrelated fact inserts", () => {
    expect(planMemoryWrite(existing, "I live in Kolkata")).toEqual({ kind: "insert" });
    expect(memorySubject("I live in Kolkata")).toBe("i live in");
  });
});

describe("matchForget — deletion and ambiguity", () => {
  const existing = [mem("a", "my favorite color is teal"), mem("b", "my favorite food is biryani"), mem("c", "my dog is named Bruno")];
  it("deletes the one clear match", () => {
    expect(matchForget(existing, "my dog")).toMatchObject({ kind: "one", memory: { id: "c" } });
    expect(matchForget(existing, "my favorite color")).toMatchObject({ kind: "one", memory: { id: "a" } });
  });
  it("asks instead of guessing when several match equally", () => {
    const r = matchForget(existing, "my favorite");
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
  it("reports no match rather than deleting something else", () => {
    expect(matchForget(existing, "my car")).toEqual({ kind: "none" });
  });
  it("after deletion the fact is no longer retrievable", () => {
    const after = existing.filter((m) => m.id !== "a");
    expect(relevantMemories(after, "what is my favorite color")).not.toContainEqual(existing[0]);
  });
});

describe("detectAutoMemory", () => {
  it("captures stable first-person facts", () => {
    expect(detectAutoMemory("By the way, my name is Tushar.")).toBe("My name is Tushar");
    expect(detectAutoMemory("I live in Kolkata")).toBe("I live in Kolkata");
  });
  it("ignores questions, stories and ordinary messages", () => {
    expect(detectAutoMemory("Is my name is Tushar a good line?")).toBeNull();
    expect(detectAutoMemory("Write a story where my name is Zed")).toBeNull();
    expect(detectAutoMemory("Explain recursion")).toBeNull();
  });
});

describe("project memory ranking & isolation", () => {
  const row = (p: Partial<ProjectRow>): ProjectRow => ({ chatId: "c2", title: "API", projectId: "p1", role: "user", content: "", createdAt: "", ...p });
  const rows = [
    row({ content: "Use PostgreSQL for the database", role: "assistant", title: "Stack decision" }),
    row({ content: "Logo should be orange" }),
    row({ chatId: "cur", content: "database in the current chat" }),
    row({ projectId: "p2", content: "database secret from another project" }),
  ];
  it("retrieves a relevant decision from another chat in the same project", () => {
    const r = rankProjectRows(rows, "p1", "cur", "which database did we pick?");
    expect(r.map((x) => x.content)).toEqual(["Use PostgreSQL for the database"]);
    expect(projectRowsBlock(r)).toContain("VISION output");
  });
  it("never leaks other projects or the current chat", () => {
    const all = rankProjectRows(rows, "p1", "cur", "database secret current");
    expect(all.some((x) => x.projectId === "p2" || x.chatId === "cur")).toBe(false);
  });
  it("falls back to recent requests only when nothing is relevant", () => {
    expect(rankProjectRows(rows, "p1", "cur", "zzz").map((x) => x.content)).toEqual(["Logo should be orange"]);
    expect(rankProjectRows(rows, "p9", "cur", "database")).toEqual([]);
  });
});

describe("server store — ownership and failures", () => {
  const calls: { sql: string; params: unknown[] }[] = [];
  let fail = false;
  let rows: any[] = [];
  beforeEach(() => { calls.length = 0; fail = false; rows = []; vi.resetModules(); vi.doMock("@/lib/cloud/d1.server", () => ({
    d1: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (fail && !sql.startsWith("CREATE") && !sql.startsWith("ALTER")) throw new Error("D1 down");
      if (sql.startsWith("SELECT id, content")) return rows;
      if (sql.includes("RETURNING")) return [{ id: "x" }];
      return [];
    },
  })); });

  it("replaces a conflicting fact scoped to the same user", async () => {
    rows = [{ id: "a", content: "my favorite color is teal", created_at: 1 }];
    const { savePermanentMemory } = await import("@/lib/ai/memory.server");
    const r = await savePermanentMemory("u1", "my favorite color is blue");
    expect(r?.plan.kind).toBe("replace");
    const upd = calls.find((c) => c.sql.startsWith("UPDATE"))!;
    expect(upd.sql).toContain("user_id = ?");
    expect(upd.params.slice(-2)).toEqual(["a", "u1"]);
  });
  it("deletes only the caller's own rows", async () => {
    const { deletePermanentMemories } = await import("@/lib/ai/memory.server");
    expect(await deletePermanentMemories("u1", ["a"])).toBe(1);
    const del = calls.find((c) => c.sql.startsWith("DELETE"))!;
    expect(del.params).toEqual(["a", "u1"]);
  });
  it("failed writes report null — never a false success", async () => {
    fail = true;
    const { savePermanentMemory, deletePermanentMemories, loadPermanentMemories } = await import("@/lib/ai/memory.server");
    expect(await savePermanentMemory("u1", "my favorite color is teal")).toBeNull();
    expect(await deletePermanentMemories("u1", "all")).toBeNull();
    expect(await loadPermanentMemories("u1")).toEqual([]);
  });
});

describe("fact-check skips private context", () => {
  it("does not web-check facts about the user's own project or memory", async () => {
    const { needsFactCheck } = await import("@/lib/ai/factcheck");
    const ans = "The feature is named Project Falcon and its primary color is amber. It is the main internal test feature known for its amber branding.";
    expect(needsFactCheck("What is our feature named and what is its primary color?", ans)).toBe(false);
    expect(needsFactCheck("Decision for this project: the feature is named Project Falcon. Just acknowledge.", ans)).toBe(false);
  });
});
