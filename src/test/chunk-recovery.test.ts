import { describe, it, expect } from "vitest";
import { nextSoftRetryDelay, SOFT_RETRIES, isChunkError } from "@/lib/chunk-recovery";

describe("page file recovery", () => {
  it("retries in place 3 times before giving up", () => {
    const t = 1_000_000;
    const delays = Array.from({ length: SOFT_RETRIES + 1 }, (_, i) => nextSoftRetryDelay(t + i));
    expect(SOFT_RETRIES).toBe(3);
    expect(delays.slice(0, 3).every((d) => typeof d === "number")).toBe(true);
    expect(delays[3]).toBeNull();
  });
  it("a new failure after 30s gets fresh retries", () => {
    expect(nextSoftRetryDelay(1_000_000 + 31_000)).not.toBeNull();
  });
  it("recognises a failed page file download", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: /src/routes/chat.index.tsx"))).toBe(true);
    expect(isChunkError(new Error("boom"))).toBe(false);
  });
});
