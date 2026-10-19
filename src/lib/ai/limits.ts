// Central AI execution budgets. Pure; every chat/deep/retry limit should be read from here.
export const AI_LIMITS = {
  /** Max characters of conversation history sent to a model (system prompt excluded). */
  historyChars: 60_000,
  /** Default-chat correction rounds after the first answer (total attempts = this + 1, capped at 5). */
  defaultCorrections: 4,
  /** Max messages considered before budgeting. */
  historyMessages: 40,
  /** Max characters kept per single message. */
  messageChars: 20_000,
  /** Retry policy for transient provider failures. */
  retry: { attempts: 2, baseMs: 400, maxMs: 4_000 },
  /** Time allowed until a provider starts streaming; every model call uses it. */
  connectMs: 30_000,
  /** Budget for transport retries and sequential fallback for one generation call. */
  providerChainMs: 120_000,
  /**
   * Outer retries for callers that wrap streamFromProvider (Deep engine). Transport failures are already
   * retried inside the provider layer, so the outer loop adds at most this many attempts (mainly for empty
   * or malformed replies) instead of multiplying the inner retry count.
   */
  outerRetries: 1,
  /** Characters of the task brief carried into every split generation step. */
  briefChars: 2_000,
} as const;
