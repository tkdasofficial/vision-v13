// Structured security events with sensitive-data redaction.
import type { SecurityEvent, SecurityStore } from "../types";

const SENSITIVE_KEY = /(pass(word)?|token|secret|otp|code|cookie|session|api[_-]?key|authorization|salt|hash)/i;
const EMAIL = /([a-z0-9._%+-])[a-z0-9._%+-]*@([a-z0-9.-]+)/gi;
const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return value.replace(EMAIL, "$1***@$2").replace(IPV4, "$1.x");
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

/** Records an event; failures are logged but never break the auth flow. High-severity events alert via console. */
export async function audit(store: SecurityStore, e: SecurityEvent) {
  const safe = { ...e, details: e.details ? (redact(e.details) as Record<string, unknown>) : undefined };
  if (e.decision === "RESTRICT" || e.decision === "DENY") console.warn("[security:alert]", JSON.stringify(safe));
  try {
    await store.logEvent({ ...safe, createdAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    console.error("[security] event write failed", (err as Error).message);
  }
}
