// Server-only wiring of the root security/ system to D1 and the current request.
import { getCookie, setCookie, getRequest } from "@tanstack/react-start/server";
import { d1 } from "./d1.server";
import {
  type RequestFacts, type Restriction, type SecurityEvent, type SecurityStore, type SignupKeys,
  extractClientIp, networkPrefix, hmacHex, randomHex, sha256Hex, canonicalEmail, isSameOriginRequest, SECURITY_CONFIG,
} from "../../../security";

export const DEVICE_COOKIE = "vision_did";

/** Keyed hashing so stored identifiers are pseudonymous. */
async function hashKey(): Promise<string> {
  const { getSecret } = await import("@/lib/ai/runtime-env.server");
  const explicit = getSecret("SECURITY_HASH_KEY");
  if (explicit) return explicit;
  // Worker bindings are not visible through process.env; read them via getSecret.
  // SIGNING_KEY is an existing Worker secret and stays stable, so pseudonyms don't change.
  const token = getSecret("CLOUDFLARE_API_TOKEN") ?? getSecret("SIGNING_KEY");
  if (!token) throw new Error("Security is not configured");
  return sha256Hex(`vision-security:${token}`);
}
export async function pseudonym(kind: string, value: string) {
  return (await hmacHex(await hashKey(), `${kind}:${value}`)).slice(0, 32);
}

export const d1Store: SecurityStore = {
  async hit(key, windowSec, now) {
    const rows = await d1<{ count: number }>(
      `INSERT INTO auth_rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
      [key, now, windowSec],
    );
    return rows[0]?.count ?? 1;
  },
  async peek(key, windowSec, now) {
    const r = (await d1<{ count: number; window_start: number }>("SELECT count, window_start FROM auth_rate_limits WHERE key = ?", [key]))[0];
    return !r || now - r.window_start >= windowSec ? 0 : r.count;
  },
  async getRestriction(scope, subject, now) {
    const r = (await d1<any>("SELECT scope, subject, reason, expires_at FROM security_restrictions WHERE scope = ? AND subject = ? AND expires_at > ?", [scope, subject, now]))[0];
    return r ? ({ scope: r.scope, subject: r.subject, reason: r.reason, expiresAt: r.expires_at } as Restriction) : null;
  },
  async putRestriction(r) {
    await d1(
      "INSERT INTO security_restrictions (scope, subject, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope, subject) DO UPDATE SET reason = excluded.reason, expires_at = MAX(expires_at, excluded.expires_at)",
      [r.scope, r.subject, r.reason.slice(0, 200), r.expiresAt, Math.floor(Date.now() / 1000)],
    );
  },
  async logEvent(e: SecurityEvent & { createdAt: number }) {
    await d1("INSERT INTO security_events (id, type, decision, subject, reasons, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      crypto.randomUUID(), e.type, e.decision ?? null, e.subject ?? null, JSON.stringify(e.reasons ?? []), JSON.stringify(e.details ?? {}), e.createdAt,
    ]);
    // Retention: occasionally purge old events and stale counters.
    if (Math.random() < 0.02) {
      const cutoff = e.createdAt - SECURITY_CONFIG.retention.eventDays * 86400;
      await d1("DELETE FROM security_events WHERE created_at < ?", [cutoff]);
      await d1("DELETE FROM security_restrictions WHERE expires_at < ?", [e.createdAt]);
      await d1("DELETE FROM auth_rate_limits WHERE window_start < ?", [e.createdAt - 60 * 86400]);
    }
  },
  async insertCredit(row) {
    const rows = await d1(
      "INSERT OR IGNORE INTO credit_ledger (id, user_id, kind, amount, idempotency_key, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
      [row.id, row.userId, row.kind, row.amount, row.idempotencyKey, row.reason, row.createdAt],
    );
    return rows.length > 0;
  },
  async creditBalance(userId) {
    return (await d1<{ n: number }>("SELECT COALESCE(SUM(amount), 0) AS n FROM credit_ledger WHERE user_id = ?", [userId]))[0]?.n ?? 0;
  },
};

export function factsFrom(headers: Headers, deviceId: string | null): RequestFacts {
  return {
    ip: extractClientIp(headers),
    userAgent: (headers.get("user-agent") ?? "").slice(0, 400),
    acceptLanguage: (headers.get("accept-language") ?? "").slice(0, 100),
    secFetchSite: headers.get("sec-fetch-site"),
    origin: headers.get("origin"),
    host: headers.get("host"),
    deviceId,
  };
}

/** Pseudonymous, rotatable device id (HttpOnly cookie). Not a fingerprint and not proof of identity. */
export function ensureDeviceId(): string {
  const existing = getCookie(DEVICE_COOKIE);
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
  const id = randomHex(16);
  setCookie(DEVICE_COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  return id;
}

export function currentFacts(): RequestFacts {
  return factsFrom(getRequest().headers, ensureDeviceId());
}

export async function keysFor(facts: RequestFacts, email: string): Promise<SignupKeys> {
  return {
    ipKey: facts.ip ? await pseudonym("ip", facts.ip) : null,
    networkKey: facts.ip ? await pseudonym("net", networkPrefix(facts.ip)) : null,
    deviceKey: facts.deviceId ? await pseudonym("dev", facts.deviceId) : null,
    emailKey: await pseudonym("email", canonicalEmail(email)),
  };
}

/** Rejects cross-site state-changing requests. */
export function assertSameOrigin(facts: RequestFacts) {
  const extra = [process.env["AUTH_ORIGIN"] ?? ""].filter(Boolean);
  if (!isSameOriginRequest(facts, extra)) throw new Error("Request blocked. Please reload the page and try again.");
}

/** Grants welcome credits once the account's email is verified (idempotent, risk-gated). */
export async function grantWelcomeCredits(userId: string, email: string, facts: RequestFacts) {
  const { grantInitialCredits, isDisposableDomain, emailDomain } = await import("../../../security");
  const keys = await keysFor(facts, email);
  try {
    return await grantInitialCredits(d1Store, { userId, emailVerified: true, networkKey: keys.networkKey, deviceKey: keys.deviceKey, disposableEmail: isDisposableDomain(emailDomain(email)) });
  } catch (e) {
    console.error("[credits] initial grant failed", (e as Error).message);
    return "ineligible" as const;
  }
}
