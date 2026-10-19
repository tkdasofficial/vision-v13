import { describe, it, expect } from "vitest";
import { callWithRetry, ENGINE_LIMITS } from "@/lib/ai/deep/engine";
import { AI_LIMITS } from "@/lib/ai/limits";

const fail503 = async () => ({ ok: false as const, status: 503, reason: "down" });

describe("shared execution limits", () => {
  it("outer Deep retries add at most one attempt on top of provider retries", async () => {
    let n = 0;
    const r = await callWithRetry(async () => { n++; return fail503(); }, [], { ...ENGINE_LIMITS, maxRetries: AI_LIMITS.outerRetries }, async () => {});
    expect(n).toBe(2); expect(r.tries).toBe(2);
    // worst case per model = (provider attempts) × (outer attempts)
    expect((AI_LIMITS.retry.attempts + 1) * (AI_LIMITS.outerRetries + 1)).toBe(6);
  });
  it("retries stop once the execution budget is spent", async () => {
    let n = 0;
    await callWithRetry(async () => { n++; return fail503(); }, [], { ...ENGINE_LIMITS, maxRetries: 3 }, async () => {}, () => true);
    expect(n).toBe(1);
  });
  it("reports the real number of tries when a permanent error stops early", async () => {
    const r = await callWithRetry(async () => ({ ok: false as const, status: 400, reason: "bad" }), [], ENGINE_LIMITS, async () => {});
    expect(r.tries).toBe(1);
  });
});
