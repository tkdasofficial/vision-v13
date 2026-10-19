// Shared types for the Vision security system. Pure TypeScript, runtime-agnostic.

export type Decision = "ALLOW" | "REQUIRE_VERIFICATION" | "TEMPORARILY_LIMIT" | "RESTRICT" | "DENY";

export type SignalCategory = "bot" | "network" | "device" | "identity" | "abuse";

export type RiskSignal = {
  id: string;
  category: SignalCategory;
  weight: number;
  /** Strong signals may drive a decision on their own; weak ones never do. */
  strong?: boolean;
};

export type RiskResult = { decision: Decision; score: number; reasons: string[] };

/** Request facts gathered from trusted infrastructure only. */
export type RequestFacts = {
  ip: string | null;
  userAgent: string;
  acceptLanguage: string;
  secFetchSite: string | null;
  origin: string | null;
  host: string | null;
  deviceId: string | null;
};

/** Optional client hints; untrusted, used only as weak signals. */
export type ClientHints = { honeypot?: string; elapsedMs?: number };

export type EntryPoint = "email" | "oauth";

export type Restriction = { scope: string; subject: string; reason: string; expiresAt: number };

export type SecurityEvent = {
  type: string;
  decision?: Decision | string;
  subject?: string;
  reasons?: string[];
  details?: Record<string, unknown>;
};

/** Durable storage required by the security system (D1 in production, memory in tests). */
export interface SecurityStore {
  /** Atomically increments a fixed-window counter and returns the new count. */
  hit(key: string, windowSec: number, now: number): Promise<number>;
  /** Reads a counter without incrementing it (0 if expired/missing). */
  peek(key: string, windowSec: number, now: number): Promise<number>;
  getRestriction(scope: string, subject: string, now: number): Promise<Restriction | null>;
  putRestriction(r: Restriction): Promise<void>;
  logEvent(e: SecurityEvent & { createdAt: number }): Promise<void>;
  /** Inserts a ledger row; returns false when the idempotency key or unique grant already exists. */
  insertCredit(row: { id: string; userId: string; kind: string; amount: number; idempotencyKey: string; reason: string; createdAt: number }): Promise<boolean>;
  creditBalance(userId: string): Promise<number>;
}

export type DnsStatus = "mx" | "no_mx_has_a" | "no_mail" | "nxdomain" | "unknown";
