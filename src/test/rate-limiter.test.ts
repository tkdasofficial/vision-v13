import { describe, it, expect } from "vitest";
import { RateLimiter, PROVIDER_LIMITS } from "@/lib/ai/rate-limiter";

describe("rate limiter", () => {
  it("uses the specified targets: NVIDIA 40 RPM / 4 concurrent, Groq 30 RPM", () => {
    expect(PROVIDER_LIMITS.nvidia).toEqual({ rpm: 40, concurrency: 4 });
    expect(PROVIDER_LIMITS.groq.rpm).toBe(30);
  });

  it("never runs more than 4 NVIDIA requests at once", async () => {
    const l = new RateLimiter();
    const rel = await Promise.all([1, 2, 3, 4].map(() => l.acquire("nvidia")));
    let fifth = false;
    const p = l.acquire("nvidia").then((r) => { fifth = true; return r; });
    await Promise.resolve();
    expect(fifth).toBe(false);
    rel[0]();
    (await p)();
    expect(fifth).toBe(true);
  });

  it("blocks the 31st Groq request within a minute", async () => {
    let t = 0;
    const l = new RateLimiter(PROVIDER_LIMITS, () => t, 5_000);
    for (let i = 0; i < 30; i++) (await l.acquire("groq"))();
    expect(l.delayFor("groq")).toBe(60_000);
    await expect(l.acquire("groq", async () => {})).rejects.toThrow();
    t = 60_001;
    expect(l.delayFor("groq")).toBe(0);
  });

  it("honors Retry-After on 429", () => {
    let t = 0;
    const l = new RateLimiter(PROVIDER_LIMITS, () => t);
    l.report("cf", 429, "7");
    expect(l.delayFor("cf")).toBe(7_000);
  });

  it("opens the circuit after 3 server errors", () => {
    let t = 0;
    const l = new RateLimiter(PROVIDER_LIMITS, () => t);
    l.report("groq", 502); l.report("groq", 503); expect(l.available("groq")).toBe(true);
    l.report("groq", 500); expect(l.available("groq")).toBe(false);
    t = 30_001; expect(l.available("groq")).toBe(true);
  });
});
