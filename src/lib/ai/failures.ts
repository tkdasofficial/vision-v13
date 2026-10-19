// Unified failure classification + bounded retry policy for model, tool and job calls. Pure, tested.
import { AI_LIMITS } from "./limits";

export type FailureKind = "transient" | "permanent" | "validation" | "permission" | "resource" | "cancelled" | "unknown";

export function classifyFailure(status: number, reason = ""): FailureKind {
  if (status === 499) return "cancelled";
  if (status === 401 || status === 403) return "permission";
  if (status === 429 || /rate limit|busy|cooling/i.test(reason)) return "resource";
  if (status === 408 || status === 504 || status === 502 || status === 503 || status >= 500) return "transient";
  if (status === 400 || status === 422) return "validation";
  if (status === 404 || status === 405 || status === 413) return "permanent";
  return "unknown";
}

/** Only transient and resource failures are retried; others need a different input, provider or user action. */
export function shouldRetry(kind: FailureKind, attempt: number, max: number = AI_LIMITS.retry.attempts): boolean {
  return (kind === "transient" || kind === "resource") && attempt < max;
}

/** Exponential backoff with full jitter, capped. `rand` is injectable for tests. */
export function backoffMs(attempt: number, rand: () => number = Math.random, p = AI_LIMITS.retry): number {
  const cap = Math.min(p.maxMs, p.baseMs * 2 ** attempt);
  return Math.round(cap * (0.5 + rand() * 0.5));
}

/** Message safe to show users: never includes provider bodies, stack traces or internals. */
export function userMessageFor(kind: FailureKind): string {
  switch (kind) {
    case "resource": return "AI is busy right now. Please try again in a moment.";
    case "permission": return "AI isn't available for this request right now.";
    case "validation": return "That request couldn't be processed. Try rephrasing it.";
    case "cancelled": return "Request cancelled.";
    default: return "AI couldn't answer right now.";
  }
}

export type RetryOpts<T> = {
  /** Returns null for success, otherwise the failure kind of this attempt's result. */
  classify: (r: T) => FailureKind | null;
  retryable?: (k: FailureKind) => boolean;
  max?: number;
  signal?: AbortSignal;
  /** Absolute epoch ms; no retry is started if its backoff would pass this deadline. */
  deadlineAt?: number;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  now?: () => number;
  onRetry?: (info: { attempt: number; kind: FailureKind; waitMs: number }) => void;
};

/** Runs fn with bounded, jittered retries. Never retries cancelled, permission, validation or permanent failures. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOpts<T>): Promise<{ result: T; attempts: number }> {
  const max = o.max ?? AI_LIMITS.retry.attempts;
  const ok = o.retryable ?? ((k: FailureKind) => k === "transient" || k === "resource");
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  for (let attempt = 0; ; attempt++) {
    const result = await fn(attempt);
    const kind = o.classify(result);
    if (!kind || o.signal?.aborted || !ok(kind) || attempt >= max) return { result, attempts: attempt + 1 };
    const waitMs = backoffMs(attempt, o.rand);
    if (o.deadlineAt && now() + waitMs > o.deadlineAt) return { result, attempts: attempt + 1 };
    o.onRetry?.({ attempt: attempt + 1, kind, waitMs });
    await sleep(waitMs);
    if (o.signal?.aborted) return { result, attempts: attempt + 1 };
  }
}
