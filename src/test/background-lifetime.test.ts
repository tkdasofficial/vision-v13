import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareKeepAlive, saveReply } from "@/lib/jobs/chat-background.server";
import { detachFromClient } from "@/lib/cloud/api-proxy.server";

vi.mock("@/lib/ai/runtime-env.server", () => ({ getD1Binding: () => ({ prepare() {} }), getAiBinding: () => undefined }));
vi.mock("@/lib/cloud/d1.server", () => ({ d1: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("accepted work survives the client leaving", () => {
  it("registers the actual work synchronously before returning a response", async () => {
    const waitUntil = vi.fn();
    const register = await prepareKeepAlive(async () => ({ waitUntil }));
    const work = Promise.resolve("saved");
    register(work);
    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(work);
  });
  it("does not accept detached work when Worker lifetime support is missing", async () => {
    await expect(prepareKeepAlive(async () => ({}))).rejects.toThrow("Background task lifetime is unavailable");
  });
  it("holds the drain until the complete result is saved after tab closure", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let saved = false;
    const source = new ReadableStream<Uint8Array>({ async start(controller) {
      controller.enqueue(new TextEncoder().encode("working"));
      await gate;
      saved = true;
      controller.enqueue(new TextEncoder().encode("done"));
      controller.close();
    } });
    const waitUntil = vi.fn();
    const register = await prepareKeepAlive(async () => ({ waitUntil }));
    const stream = detachFromClient(source, register);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(saved).toBe(false);
    release?.();
    await waitUntil.mock.calls[0][0];
    expect(saved).toBe(true);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
  it("replaces only an owned empty assistant placeholder", async () => {
    const { d1 } = await import("@/lib/cloud/d1.server");
    vi.mocked(d1).mockResolvedValue([]);
    await saveReply("owner", "chat-1234", "job-12345678", "finished story");
    const sql = vi.mocked(d1).mock.calls.find(([query]) => query.includes("ON CONFLICT"))?.[0] ?? "";
    expect(sql).toContain("chat_messages.session_id = excluded.session_id");
    expect(sql).toContain("TRIM(chat_messages.content) = ''");
    expect(sql).toContain("chat_messages.role = 'assistant'");
  });
  it("never reports success when the final reply could not be saved", async () => {
    const { d1 } = await import("@/lib/cloud/d1.server");
    vi.mocked(d1).mockRejectedValueOnce(new Error("storage unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(saveReply("owner", "chat-1234", "reply-1234", "finished answer")).rejects.toThrow("reply could not be saved");
  });
});