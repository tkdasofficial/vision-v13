// Durable fixed-window rate limits backed by the SecurityStore (shared across Worker instances).
import type { SecurityStore } from "../types";
import type { Limit } from "../config";

export class RateLimitError extends Error {
  constructor() { super("Too many attempts. Please wait a few minutes and try again."); this.name = "RateLimitError"; }
}

export const nowSec = () => Math.floor(Date.now() / 1000);

/** Increments every key; throws RateLimitError when any exceeds its limit. */
export async function enforceLimits(store: SecurityStore, checks: [key: string | null, limit: Limit][], now = nowSec()) {
  for (const [key, limit] of checks) {
    if (!key) continue;
    const n = await store.hit(`rl:${key}`, limit.windowSec, now);
    if (n > limit.max) throw new RateLimitError();
  }
}
