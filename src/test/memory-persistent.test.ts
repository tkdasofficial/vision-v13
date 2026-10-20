// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { detectMemoryCommand, detectAutoMemory, relevantMemories, planMemoryWrite } from "@/lib/ai/memory";
import { memoryPrivacy, userMemoryTarget } from "@/lib/ai/memory-policy";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null, fail: false, beforeWrite: null as (() => void) | null }));
vi.mock("@/lib/cloud/d1.server", () => ({ d1: async (sql: string, p: unknown[] = []) => {
  if (state.fail) throw new Error("D1 unavailable");
  const db = state.db;
  if (!db) throw new Error("Test database missing");
  if (/^(INSERT INTO user_memories|UPDATE user_memories)/.test(sql)) { const hook = state.beforeWrite; state.beforeWrite = null; hook?.(); }
  return db.prepare(sql).all(...p as (string | number | null)[]);
} }));
let store: typeof import("@/lib/ai/memory.server");
let handler: typeof import("@/lib/ai/memory-handler.server");
beforeEach(async () => {
  vi.resetModules(); state.db = new DatabaseSync(":memory:"); state.fail = false; state.beforeWrite = null;
  state.db.exec("CREATE TABLE user_settings(id TEXT PRIMARY KEY, user_id TEXT, prefs TEXT, updated_at TEXT); CREATE TABLE chat_sessions(id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT); CREATE TABLE workspace_projects(id TEXT, user_id TEXT, memory TEXT); CREATE TABLE chat_messages(id TEXT, session_id TEXT, role TEXT, content TEXT, created_at TEXT);");
  state.db.exec("INSERT INTO user_settings VALUES('s1','u1','{\"tone\":\"formal\"}',NULL),('s2','u2','{}',NULL); INSERT INTO chat_sessions VALUES('c1','u1',NULL),('c2','u1',NULL),('c3','u2',NULL);");
  store = await import("@/lib/ai/memory.server"); handler = await import("@/lib/ai/memory-handler.server");
  await store.ensureMem();
});
afterEach(() => state.db?.close());
const run = (text: string, extra = {}) => handler.handleChatMemory({ userId: "u1", chatId: "c1", owned: true, scope: "none", text, history: [], ...extra });

describe("explicit memory intent", () => {
  it.each([
    ["Remember this", "save_context"], ["Save this to memory", "save_context"], ["Keep this in mind", "save_context"],
    ["Remeber that I prefer short answers", "save"], ["Remember what I told you about my project?", "recall"],
    ["Update what you remember: my favorite color is blue", "save"], ["That has changed", "update_context"],
    ["Forget this", "forget_context"], ["Don't remember this", "forget_context"], ["Forget what I told you about my dog", "forget"],
    ["Turn memory off", "disable"], ["Stop remembering things", "disable"], ["Turn memory back on", "enable"], ["Resume remembering", "enable"],
  ])("recognizes %s", (text, action) => expect(detectMemoryCommand(text).action).toBe(action));
  it("does not interpret ordinary quoted instructions as commands", () => {
    expect(detectMemoryCommand('Write a scene saying "turn memory off"').action).toBe("none");
    expect(detectMemoryCommand("Forget it, write a poem instead").action).toBe("none");
    expect(userMemoryTarget([{ role: "assistant", content: "Your city is Paris" }]).kind).toBe("clarify");
  });
  it("clarifies missing update targets instead of changing anything", async () => {
    await store.savePermanentMemory("u1", "my favorite color is teal");
    await run("That has changed");
    expect((await store.loadPermanentMemories("u1"))[0]?.content).toBe("my favorite color is teal");
  });
});

describe("permanent lifecycle with real SQLite constraints", () => {
  it("saves in one conversation and recalls in another without provider access", async () => {
    await run("Remember that my favorite color is teal");
    const recalled = await run("What do you remember about me?", { chatId: "c2" });
    expect(recalled.reply).toContain("my favorite color is teal");
    expect((await store.listMemoryItems("u1"))?.[0]).toMatchObject({ source: "explicit", sourceRef: "c1", category: "preference", status: "active" });
  });
  it("context save uses only a bounded user-supplied fact", async () => {
    await run("Remember this", { history: [{ role: "user", content: "My editor is Neovim" }, { role: "assistant", content: "You also use Vim" }] });
    expect((await store.loadPermanentMemories("u1")).map((m) => m.content)).toEqual(["My editor is Neovim"]);
  });
  it("updates a subject, preserves unrelated facts and normalizes duplicates", async () => {
    await store.savePermanentMemory("u1", "my favourite colour is teal.");
    await store.savePermanentMemory("u1", "my dog is Bruno");
    await run("Update what you remember: my favorite color is blue");
    const list = await store.loadPermanentMemories("u1");
    expect(list).toHaveLength(2);
    expect(list.some((m) => m.content === "my favorite color is blue")).toBe(true);
    expect(planMemoryWrite(list, "My favorite color is blue.").kind).toBe("duplicate");
  });
  it("deletes storage and prevents derived history from resurrecting forgotten facts", async () => {
    await store.savePermanentMemory("u1", "my dog is Bruno");
    state.db?.exec("INSERT INTO chat_messages VALUES('m1','c2','user','my dog is Bruno','2026-01-01');");
    await run("Forget what I told you about my dog");
    expect(await store.loadPermanentMemories("u1")).toEqual([]);
    expect(await store.loadPastChatsMemory("u1", "c1", "my dog")).toBe("");
    expect(state.db?.prepare("SELECT COUNT(*) AS n FROM chat_messages").get()?.n).toBe(1);
  });
  it("turns both retrieval switches off, preserves facts, prevents saves, then enables", async () => {
    await store.savePermanentMemory("u1", "my favorite color is teal");
    await run("Turn memory off");
    expect(JSON.parse(String(state.db?.prepare("SELECT prefs FROM user_settings WHERE user_id='u1'").get()?.prefs))).toEqual({ tone: "formal", savedMemories: false, chatHistory: false });
    expect((await run("What do you remember about me?")).reply).not.toContain("teal");
    expect(await store.savePermanentMemory("u1", "I live in Kolkata", "auto")).toBeNull();
    expect((await store.loadPermanentMemories("u1"))).toHaveLength(1);
    await run("Resume remembering");
    expect((await run("What do you remember about me?")).reply).toContain("teal");
  });
  it("explicit deletion remains available while memory is off", async () => {
    await store.savePermanentMemory("u1", "my dog is Bruno"); await store.setMemoryEnabled("u1", false);
    await run("Forget my dog"); expect(await store.loadPermanentMemories("u1")).toEqual([]);
  });
  it("isolates owners on reads, edits, deletes and commands", async () => {
    const r = await store.savePermanentMemory("u1", "my dog is Bruno");
    expect(await store.loadPermanentMemories("u2")).toEqual([]);
    expect(await store.editMemory("u2", r?.memory.id ?? "missing", "my dog is Pip")).toBe(false);
    expect(await store.deletePermanentMemories("u2", [r?.memory.id ?? "missing"])).toBe(0);
    await run("Remember that I live in Paris", { owned: false });
    expect(await store.loadPermanentMemories("u1")).toHaveLength(1);
  });
  it("concurrent identical saves and retries create only one row", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => store.savePermanentMemory("u1", "my favorite color is teal")));
    expect(results.every(Boolean)).toBe(true);
    expect(await store.loadPermanentMemories("u1")).toHaveLength(1);
  });
  it("conflicting concurrent saves cannot overwrite accepted newer content", async () => {
    await store.savePermanentMemory("u1", "my favorite color is teal");
    const results = await Promise.all([store.savePermanentMemory("u1", "my favorite color is blue"), store.savePermanentMemory("u1", "my favorite color is green")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.loadPermanentMemories("u1")).toHaveLength(1);
  });
  it("a toggle during extraction blocks the pending write in SQL", async () => {
    state.beforeWrite = () => state.db?.exec("UPDATE user_settings SET prefs='{\"savedMemories\":false}' WHERE user_id='u1'");
    expect(await store.savePermanentMemory("u1", "I live in Kolkata", "auto")).toBeNull();
    expect(await store.loadPermanentMemories("u1")).toEqual([]);
  });
  it("a clear during extraction blocks stale resurrection", async () => {
    state.beforeWrite = () => state.db?.exec("INSERT INTO user_memory_state VALUES('u1',1,1)");
    expect(await store.savePermanentMemory("u1", "I live in Kolkata", "auto")).toBeNull();
  });
  it("automatic writes cannot override explicit saved corrections", async () => {
    await store.savePermanentMemory("u1", "my favorite color is blue");
    await store.savePermanentMemory("u1", "my favorite color is teal", "auto");
    expect((await store.loadPermanentMemories("u1"))[0]?.content).toBe("my favorite color is blue");
  });
  it("automatic formation is deferred and never runs on explicit forget/disable", async () => {
    const r = await run("I live in Kolkata");
    expect(await store.loadPermanentMemories("u1")).toEqual([]);
    await r.auto?.(); expect((await store.loadPermanentMemories("u1"))[0]?.content).toBe("I live in Kolkata");
    expect((await run("Forget my city")).auto).toBeNull();
    expect((await run("Turn memory off")).auto).toBeNull();
  });
  it("database failures never confirm mutations or claim empty recall", async () => {
    await store.savePermanentMemory("u1", "my dog is Bruno"); state.fail = true;
    const r = await run("Forget my dog"); expect(r.reply).toContain("couldn't");
    state.fail = false; expect(await store.loadPermanentMemories("u1")).toHaveLength(1);
  });
});

describe("privacy and relevance", () => {
  it.each(["My password is secret123", "My API key is abc123", "My SSN is 123-45-6789"])("rejects sensitive credentials: %s", async (fact) => {
    expect(memoryPrivacy(fact)).toBe("secret"); expect(await store.savePermanentMemory("u1", fact)).toBeNull();
    expect(detectAutoMemory(fact)).toBeNull();
  });
  it("does not automatically store private, temporary, quoted or invented information", () => {
    expect(detectAutoMemory("My name is Asha and I was diagnosed with a disease")).toBeNull();
    expect(detectAutoMemory("Today I live in Paris")).toBeNull();
    expect(detectAutoMemory('He said "my name is Mira"')).toBeNull();
    expect(detectAutoMemory("I'm building a lighthouse management project")).toBe("I'm building a lighthouse management project");
  });
  it("injects relevant facts only and respects the budget", () => {
    const facts = [{ id: "a", content: "my dog is Bruno", createdAt: 2 }, { id: "b", content: "my editor is Neovim", createdAt: 1 }];
    expect(relevantMemories(facts, "configure my editor").map((m) => m.id)).toEqual(["b"]);
    expect(relevantMemories(facts, "my dog", 2)).toEqual([]);
  });
});