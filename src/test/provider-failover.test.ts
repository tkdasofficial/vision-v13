import { describe, it, expect, vi } from "vitest";
import { orchestrateText, ALL_PROVIDERS_UNAVAILABLE } from "@/lib/ai/orchestrator.server";
import { TEXT_CHAIN } from "@/lib/ai/models.server";
import { RateLimiter } from "@/lib/ai/rate-limiter";
import { withRetry, classifyFailure } from "@/lib/ai/failures";

const success = () => ({ ok: true as const, body: new Response('data: {"choices":[{"delta":{"content":"नमस्ते"},"finish_reason":"stop"}]}\n\n').body as ReadableStream<Uint8Array> });
const failed = (status: number, reason = "unavailable") => ({ ok: false as const, status, reason });
const options = () => ({ maxTokens: 6000, deep: false, signal: new AbortController().signal });
describe("sequential provider orchestration", () => {
  for (const winner of [0, 1, 2]) it(`stops at successful provider ${winner + 1}`, async () => {
    const messages = [{ role: "user", content: "हिंदी में PDF बनाओ" }];
    const call = vi.fn().mockImplementation(async () => call.mock.calls.length <= winner ? failed(401, "invalid key") : success());
    const stages: string[] = [];
    const result = await orchestrateText(messages, { ...options(), call, onEvent: (e) => { stages.push(e.stage); } });
    expect(result.ok).toBe(true);
    expect(call.mock.calls.map((args) => args[0].provider)).toEqual(["nvidia", "groq", "cf"].slice(0, winner + 1));
    expect(call.mock.calls.every((args) => args[1] === messages && args[2].maxTokens === 6000)).toBe(true);
    expect(stages).toEqual(Array(winner).fill("switching_provider"));
  });
  it("returns final failure only after three eligible failures", async () => {
    const call = vi.fn().mockResolvedValue(failed(503));
    expect(await orchestrateText([], { ...options(), call })).toEqual({ ok: false, status: 503, reason: ALL_PROVIDERS_UNAVAILABLE });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("does not retry invalid input through alternative providers", async () => {
    const call = vi.fn().mockResolvedValue(failed(400, "invalid schema"));
    expect((await orchestrateText([], { ...options(), call })).ok).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("falls back when one provider rejects the payload as too large (413)", async () => {
    const call = vi.fn().mockImplementation(async () => call.mock.calls.length === 1 ? failed(413, "request too large") : success());
    const result = await orchestrateText([], { ...options(), call });
    expect(result.ok).toBe(true);
    expect(call.mock.calls.map((args) => args[0].provider)).toEqual(["nvidia", "groq"]);
  });
  it("reports a too-large request only when every provider rejects it", async () => {
    const call = vi.fn().mockResolvedValue(failed(413, "request too large"));
    const result = await orchestrateText([], { ...options(), call });
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("discards partial failed streams before switching", async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"response":"partial"}\n')); }, pull(c) { c.error(new Error("network")); } });
    const call = vi.fn().mockResolvedValueOnce({ ok: true, body }).mockResolvedValueOnce(success());
    const result = await orchestrateText([], { ...options(), call });
    expect(result.ok && result.text).toBe("नमस्ते");
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("does not start calls after cancellation or the deadline", async () => {
    const call = vi.fn();
    await orchestrateText([], { ...options(), deadlineAt: Date.now() - 1, call });
    expect(call).not.toHaveBeenCalled();
    const ctrl = new AbortController(); ctrl.abort();
    expect(await orchestrateText([], { ...options(), signal: ctrl.signal, call })).toMatchObject({ status: 499 });
    expect(call).not.toHaveBeenCalled();
  });
  it("retains the exact provider order", () => expect(TEXT_CHAIN.map((m) => m.provider)).toEqual(["nvidia", "groq", "cf"]));
  it("reserves time for healthy fallbacks when the primary consumes its deadline", async () => {
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const call = vi.fn().mockImplementation(async (_model, _messages, opts) => {
        if (call.mock.calls.length === 1) { now = opts.deadlineAt; return failed(504, "timeout"); }
        return success();
      });
      const result = await orchestrateText([], { ...options(), deadlineAt: 121000, call });
      expect(result.ok).toBe(true);
      expect(call.mock.calls.map((args) => args[0].provider)).toEqual(["nvidia", "groq"]);
      expect(call.mock.calls[0][2].deadlineAt).toBe(61000);
      expect(call.mock.calls[1][2].deadlineAt).toBe(91000);
      expect(call.mock.calls.every((args) => args[2].maxTokens === 6000)).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it("bounds transport retries to three attempts", async () => {
    const call = vi.fn().mockResolvedValue(failed(503));
    await withRetry<{ ok: false; status: number; reason: string }>(call, { classify: (r) => classifyFailure(r.status), sleep: async () => {}, max: 2 });
    expect(call).toHaveBeenCalledTimes(3);
  });
});
describe("concurrency reservations", () => {
  it("transfers slots without letting a fresh caller overtake a waiter", async () => {
    const limiter = new RateLimiter({ nvidia: { rpm: 100, concurrency: 1 } });
    const first = await limiter.acquire("nvidia");
    const second = limiter.acquire("nvidia"); first();
    let thirdStarted = false;
    const third = limiter.acquire("nvidia").then((release) => { thirdStarted = true; return release; });
    const secondRelease = await second;
    expect(thirdStarted).toBe(false); expect(limiter.snapshot("nvidia").active).toBe(1);
    secondRelease(); (await third)(); expect(limiter.snapshot("nvidia").active).toBe(0);
  });
  it("removes cancelled queue entries", async () => {
    const limiter = new RateLimiter({ nvidia: { rpm: 100, concurrency: 1 } });
    const release = await limiter.acquire("nvidia"); const ctrl = new AbortController();
    const pending = limiter.acquire("nvidia", undefined, ctrl.signal); ctrl.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(limiter.snapshot("nvidia").queued).toBe(0); release();
  });
  it("honors Retry-After dates without truncating provider guidance", () => {
    const now = Date.parse("2026-10-16T07:00:00Z"); const limiter = new RateLimiter(undefined, () => now);
    limiter.report("groq", 429, "Fri, 16 Oct 2026 07:05:00 GMT");
    expect(limiter.delayFor("groq")).toBe(300000); expect(limiter.available("groq")).toBe(false);
  });
});