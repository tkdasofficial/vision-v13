import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/ai/runtime-env.server", () => ({ getD1Binding: () => null, getAiBinding: () => null, getSecret: () => undefined }));
import { trackGeneration, latestGeneration } from "@/lib/ai/generation-store.server";
import { viewGeneration, generationTaskState, endedWithoutAnswer, questionAnsweredByJob, STALE_AFTER_MS, type GenerationRow } from "@/lib/ai/generation-state";
import { detachFromClient } from "@/lib/cloud/api-proxy.server";

// In-memory stand-in for the chat_generations table.
function fakeDb() {
  const rows = new Map<string, any>();
  const db = vi.fn(async (sql: string, p: any[] = []) => {
    if (sql.startsWith("CREATE")) return [];
    if (sql.startsWith("INSERT OR IGNORE")) { if (!rows.has(p[0])) rows.set(p[0], { id: p[0], user_id: p[1], chat_id: p[2], status: "running", stage: null, detail: null, history: "[]", error: null, created_at: p[3], updated_at: p[4] }); return []; }
    if (sql.includes("SET stage")) { const r = rows.get(p[4]); if (r && r.user_id === p[5] && r.status === "running") Object.assign(r, { stage: p[0], detail: p[1], history: p[2], updated_at: p[3] }); return []; }
    if (sql.includes("SET status")) { const r = rows.get(p[4]); if (r && r.user_id === p[5] && r.status === "running") Object.assign(r, { status: p[0], error: p[1], history: p[2], updated_at: p[3] }); return []; }
    if (sql.startsWith("SELECT")) return [...rows.values()].filter((r) => r.user_id === p[1] && (sql.includes("chat_id = ?") ? r.chat_id === p[0] : r.id === p[0]));
    return [];
  });
  return { db, rows };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("reload during generation", () => {
  it("a reloaded chat sees the live worker status while generation continues", async () => {
    const { db } = fakeDb();
    const g = trackGeneration("u1", "chat-1234", "reply-1234", db);
    g.stage("thinking"); g.stage("writing"); g.stage("switching_provider");
    await flush(); await flush(); await flush();
    const v = (await latestGeneration("u1", { chatId: "chat-1234" }, db))!;
    expect(v.status).toBe("running");
    expect(generationTaskState(v)).toMatchObject({ taskId: "reply-1234", stage: "writing", history: ["thinking", "writing"] });
    await g.finish("completed");
  });

  it("another user can never read the generation", async () => {
    const { db } = fakeDb();
    const g = trackGeneration("u1", "chat-1234", "reply-1234", db); await g.finish("completed");
    expect(await latestGeneration("u2", { chatId: "chat-1234" }, db)).toBeNull();
  });

  it("the final outcome is persisted once and cannot be overwritten", async () => {
    const { db, rows } = fakeDb();
    const g = trackGeneration("u1", "chat-1234", "reply-1234", db);
    g.stage("writing");
    await g.finish("completed");
    await g.finish("failed", "late");
    g.stage("fixing_issues");
    await flush();
    expect(rows.get("reply-1234")).toMatchObject({ status: "completed", error: null, stage: "writing" });
  });

  it("failed and cancelled generations end with a clear note instead of a spinner", async () => {
    const { db } = fakeDb();
    const g = trackGeneration("u1", "chat-1234", "reply-1234", db); await g.finish("failed", "All providers are busy");
    const v = (await latestGeneration("u1", { chatId: "chat-1234" }, db))!;
    expect(v.status).toBe("failed");
    expect(generationTaskState(v)).toBeNull();
    expect(endedWithoutAnswer(v)).toContain("All providers are busy");
    expect(endedWithoutAnswer({ ...v, status: "cancelled" })).toBe("Stopped.");
    expect(endedWithoutAnswer({ ...v, status: "completed" })).toBeNull();
  });

  it("a running generation with no heartbeat for 90s is reported as interrupted", () => {
    const row: GenerationRow = { id: "r", chat_id: "c", status: "running", stage: "writing", detail: null, history: '["writing"]', error: null, created_at: 0, updated_at: 1000 };
    expect(viewGeneration(row, 1000 + STALE_AFTER_MS - 1).status).toBe("running");
    const v = viewGeneration(row, 1000 + STALE_AFTER_MS + 1);
    expect(v.status).toBe("interrupted");
    expect(endedWithoutAnswer(v)).toMatch(/interrupted/);
  });

  it("a question answered by a file-creation job ends the reconnect poller instead of showing Thinking for 15 minutes", () => {
    const sentAt = Date.parse("2026-10-17T04:00:23.000Z");
    expect(questionAnsweredByJob([{ createdAt: "2026-10-17T04:00:23.500Z" }], sentAt)).toBe(true);
    expect(questionAnsweredByJob([{ createdAt: "2026-10-17T03:59:00.000Z" }], sentAt)).toBe(false); // older task from a previous question
    expect(questionAnsweredByJob([], sentAt)).toBe(false); // written-answer question keeps the generation reconnect
    expect(questionAnsweredByJob([{ createdAt: "not-a-date" }], sentAt)).toBe(false);
  });

  it("storage failures never break the generation", async () => {
    const db = vi.fn(async () => { throw new Error("d1 down"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const g = trackGeneration("u1", "chat-1234", "reply-x", db as any);
    g.stage("writing");
    await expect(g.finish("completed")).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("preview proxy keeps the generation alive after the browser leaves", () => {
  it("keeps reading the backend stream to the end after the client cancels (no duplicate request needed)", async () => {
    let pulled = 0; let finished = false;
    const chunks = ["a", "b", "c", "d"].map((s) => new TextEncoder().encode(s));
    const upstream = new ReadableStream<Uint8Array>({
      async pull(c) { await flush(); if (pulled < chunks.length) c.enqueue(chunks[pulled++]); else { finished = true; c.close(); } },
    });
    const out = detachFromClient(upstream);
    const reader = out.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("a");
    await reader.cancel(); // page reload
    for (let i = 0; i < 20 && !finished; i++) await flush();
    expect(pulled).toBe(4);
    expect(finished).toBe(true);
  });

  it("passes the whole stream through when the client stays", async () => {
    const out = detachFromClient(new Response("hello world").body!);
    expect(await new Response(out).text()).toBe("hello world");
  });
});
