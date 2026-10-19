import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ user: { id: "owner" }, events: [] as string[], rows: [] as any[], release: (() => {}) as () => void }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: db.user }) }));
vi.mock("@/lib/idb-cache", () => ({ idbGet: async () => null, idbSet: async () => {}, idbDelete: async () => {}, idbClear: async () => {} }));
vi.mock("@/lib/cloud/client", () => ({ supabase: { from: (table: string) => ({
  select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  insert: () => new Promise((resolve) => { db.release = () => { db.events.push("session-saved"); resolve({ error: null }); }; }),
  upsert: async (rows: any[]) => { db.rows = rows; db.events.push(`${table}:${rows[0].content}`); return { error: null }; },
  update: () => ({ eq: async () => ({ error: null }) }),
}) } }));
import { ChatHistoryProvider, useChatHistory } from "@/context/ChatHistoryContext";
describe("durable question before background dispatch", () => {
  it("reuses the server runtime reply id instead of saving a second copy", async () => {
    let api: ReturnType<typeof useChatHistory> | undefined;
    function Probe() { api = useChatHistory(); return null; }
    render(<ChatHistoryProvider><Probe /></ChatHistoryProvider>);
    await act(async () => {});
    if (!api) throw new Error("Missing context");
    const current = api;
    const id = "job-7c7e4c9d-dd26-483f-93c2-406cf267d41f";
    await act(async () => { await current.persistChatMessages("existing", [{ id, role: "assistant", content: "Saved scene prompts", timestamp: new Date() }]); });
    expect(db.rows.map((r) => r.id)).toEqual([id]);
  });
  it("an immediate deletion clears the older queued answer so reload cannot restore it", async () => {
    vi.useFakeTimers();
    db.events.length = 0;
    let api: ReturnType<typeof useChatHistory> | undefined;
    function Probe() { api = useChatHistory(); return null; }
    render(<ChatHistoryProvider><Probe /></ChatHistoryProvider>);
    await act(async () => {});
    if (!api) throw new Error("Missing context");
    const current = api;
    const reply = { id: "reply", role: "assistant" as const, content: "Old answer", timestamp: new Date() };
    await act(async () => { current.updateChatMessages("existing", [reply]); });
    await act(async () => { await current.persistChatMessages("existing", [{ ...reply, content: "", deleted: true }]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(db.events).toEqual(["chat_messages:"]);
    vi.useRealTimers();
  });
  it("waits for the account session and question to be saved before work can start", async () => {
    db.events.length = 0;
    let api: ReturnType<typeof useChatHistory> | undefined;
    function Probe() { api = useChatHistory(); return null; }
    render(<ChatHistoryProvider><Probe /></ChatHistoryProvider>);
    await act(async () => {});
    if (!api) throw new Error("Missing context");
    const current = api;
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      const id = current.addChat("Excel", "Create workbook");
      pending = current.persistChatMessages(id, [{ id: "question", role: "user", content: "Create workbook", timestamp: new Date() }]).then(() => { db.events.push("dispatch"); });
      await Promise.resolve();
    });
    expect(db.events).toEqual([]);
    await act(async () => { db.release(); await pending; });
    expect(db.events).toEqual(["session-saved", "chat_messages:Create workbook", "dispatch"]);
  });
});