// D1 failure handling for memory, simulated with test doubles only (no real database is touched):
// rejected queries, timeouts, partial failures and zero-row writes must never read as success,
// must always settle (so chat generation can't hang), and must leave unrelated chat context usable.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryOutcomeNote, type MemoryOutcome } from "@/lib/ai/memory";

type Handler = (sql: string, params: unknown[]) => Promise<any[]>;
let handler: Handler;
const calls: string[] = [];

async function store() {
  vi.resetModules();
  vi.doMock("@/lib/cloud/d1.server", () => ({ d1: (sql: string, params: unknown[] = []) => { calls.push(sql); return handler(sql, params); } }));
  return import("@/lib/ai/memory.server");
}
const ok = (sql: string): Promise<any[]> => {
  if (sql.startsWith("SELECT id, content")) return Promise.resolve([{ id: "a", content: "my favorite color is teal", created_at: 1 }]);
  if (sql.includes("RETURNING")) return Promise.resolve([{ id: "a" }]);
  return Promise.resolve([]);
};
const schema = (sql: string) => sql.startsWith("CREATE") || sql.startsWith("ALTER");

beforeEach(() => { calls.length = 0; handler = ok; });
afterEach(() => { vi.useRealTimers(); vi.doUnmock("@/lib/cloud/d1.server"); });

describe("rejected D1 operations", () => {
  it("a zero-row insert never confirms permanent memory was saved", async () => {
    handler = (sql) => sql.startsWith("INSERT") ? Promise.resolve([]) : ok(sql);
    const { savePermanentMemory } = await store();
    expect(await savePermanentMemory("u1", "I live in Kolkata")).toBeNull();
  });
  it("update (same-subject replace) rejected → null, no success", async () => {
    handler = (sql) => (sql.startsWith("UPDATE") ? Promise.reject(new Error("D1_ERROR")) : ok(sql));
    const { savePermanentMemory } = await store();
    expect(await savePermanentMemory("u1", "my favorite color is blue")).toBeNull();
  });
  it("update that matches zero rows (record vanished / not owned) → null", async () => {
    handler = (sql) => (sql.startsWith("UPDATE") ? Promise.resolve([]) : ok(sql));
    const { savePermanentMemory } = await store();
    expect(await savePermanentMemory("u1", "my favorite color is blue")).toBeNull();
  });
  it("insert rejected after a successful read → null", async () => {
    handler = (sql) => (sql.startsWith("INSERT") ? Promise.reject(new Error("SQLITE_BUSY")) : ok(sql));
    const { savePermanentMemory } = await store();
    expect(await savePermanentMemory("u1", "I live in Kolkata")).toBeNull();
  });
  it("single delete rejected → null (not 0, not success)", async () => {
    handler = (sql) => (sql.startsWith("DELETE") ? Promise.reject(new Error("D1_ERROR")) : ok(sql));
    const { deletePermanentMemories } = await store();
    expect(await deletePermanentMemories("u1", ["a"])).toBeNull();
  });
  it("read failure is distinguishable from an empty memory", async () => {
    handler = (sql) => (schema(sql) ? ok(sql) : Promise.reject(new Error("D1_ERROR")));
    const { tryLoadPermanentMemories, loadPermanentMemories } = await store();
    expect(await tryLoadPermanentMemories("u1")).toBeNull();
    expect(await loadPermanentMemories("u1")).toEqual([]);
  });
  it("schema setup failure is retried on the next call instead of being cached", async () => {
    handler = () => Promise.reject(new Error("D1 unavailable"));
    const { savePermanentMemory } = await store();
    expect(await savePermanentMemory("u1", "my dog is Bruno")).toBeNull();
    handler = ok;
    expect((await savePermanentMemory("u1", "my dog is Bruno"))?.plan.kind).toBe("insert");
  });
});

describe("timeouts — memory calls always settle", () => {
  it("a hung D1 query resolves to failure after the bound for save, delete and load", async () => {
    vi.useFakeTimers();
    handler = (sql) => (schema(sql) ? ok(sql) : new Promise<any[]>(() => {}));
    const { savePermanentMemory, deletePermanentMemories, tryLoadPermanentMemories, MEMORY_DB_TIMEOUT_MS } = await store();
    const pending = Promise.all([
      savePermanentMemory("u1", "my favorite color is blue"),
      deletePermanentMemories("u1", "all"),
      tryLoadPermanentMemories("u1"),
    ]);
    await vi.advanceTimersByTimeAsync(MEMORY_DB_TIMEOUT_MS * 3);
    expect(await pending).toEqual([null, null, null]);
  });
  it("unrelated chat context lookups also fall back instead of hanging", async () => {
    vi.useFakeTimers();
    handler = () => new Promise<any[]>(() => {});
    const { loadChatContext, loadProjectMemory, MEMORY_DB_TIMEOUT_MS } = await store();
    const pending = Promise.all([loadChatContext("u1", "chat-1"), loadProjectMemory("u1", "p1", "chat-1", "hi")]);
    await vi.advanceTimersByTimeAsync(MEMORY_DB_TIMEOUT_MS + 10);
    const [ctx, project] = await pending;
    expect(ctx).toMatchObject({ projectId: null, scope: "none", owned: false });
    expect(project).toBe("");
  });
});

describe("reply instructions never confirm a failed operation", () => {
  const failures: MemoryOutcome[] = [
    { kind: "save_failed" },
    { kind: "forget_failed", content: "my favorite color is teal" },
    { kind: "forget_all_failed" },
    { kind: "lookup_failed" },
  ];
  it.each(failures)("$kind tells the user it failed and to try again", (o) => {
    const n = memoryOutcomeNote(o);
    expect(n).toMatch(/FAILED|could not be read/);
    expect(n).toMatch(/try again/);
    expect(n).toMatch(/Never say it succeeded/);
    expect(n).not.toMatch(/is now stored|\) were deleted|(?<!nothing )was deleted|was replaced/);
  });
  it("success wording only comes from confirmed outcomes", () => {
    expect(memoryOutcomeNote({ kind: "saved", content: "x" })).toContain("is now stored");
    expect(memoryOutcomeNote({ kind: "forgot", content: "x" })).toContain("was deleted");
    expect(memoryOutcomeNote({ kind: "forgot_all", count: 2 })).toContain("(2) were deleted");
  });
});
