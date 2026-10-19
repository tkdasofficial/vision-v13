// Regression: a provider whose stream opens and then stalls (no data, never closes) must not
// hang the chain — the orchestrator stops it at its budget share and fails over to the next.
import { describe, expect, it } from "vitest";
import { orchestrateText } from "@/lib/ai/orchestrator.server";

const enc = new TextEncoder();
const stalled = () => new ReadableStream<Uint8Array>({ start() { /* never enqueues, never closes */ } });
const answer = (text: string) => new ReadableStream<Uint8Array>({
  start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`));
    c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n`));
    c.close();
  },
});
const models = [
  { provider: "nvidia" as const, model: "a", label: "A" },
  { provider: "groq" as const, model: "b", label: "B" },
];

describe("orchestrateText stalled stream", () => {
  it("fails over to the next provider when a stream stalls past its deadline", async () => {
    const started = Date.now();
    const res = await orchestrateText([{ role: "user", content: "hi" }], {
      maxTokens: 10, deep: false, signal: new AbortController().signal, models, deadlineAt: Date.now() + 400,
      call: async (m) => ({ ok: true, body: m.model === "a" ? stalled() : answer("from B") }),
    });
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.text).toBe("from B"); expect(res.model.model).toBe("b"); }
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it("fails over when a provider never answers at all", async () => {
    const res = await orchestrateText([{ role: "user", content: "hi" }], {
      maxTokens: 10, deep: false, signal: new AbortController().signal, models, deadlineAt: Date.now() + 400,
      call: async (m) => (m.model === "a" ? new Promise<never>(() => {}) : { ok: true, body: answer("from B") }),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.model.model).toBe("b");
  }, 15_000);
});
