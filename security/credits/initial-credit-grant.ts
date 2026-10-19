// Initial free-credit grant: server-side eligibility, one grant per account, idempotent ledger insert.
import type { SecurityStore } from "../types";
import { SECURITY_CONFIG } from "../config";
import { audit } from "../audit/audit-logger";

export type GrantSubject = { userId: string; emailVerified: boolean; networkKey: string | null; deviceKey: string | null; disposableEmail: boolean };
export type GrantOutcome = "granted" | "duplicate" | "withheld" | "ineligible";

export async function grantInitialCredits(store: SecurityStore, s: GrantSubject, now = Math.floor(Date.now() / 1000), cfg = SECURITY_CONFIG.credits): Promise<GrantOutcome> {
  if (!s.emailVerified) return "ineligible";
  const blocked = await store.getRestriction("credits:user", s.userId, now);
  if (blocked && blocked.expiresAt > now) return "withheld";

  const reasons: string[] = [];
  if (s.disposableEmail) reasons.push("disposable_email");
  if (s.networkKey && (await store.peek(`grant:net:${s.networkKey}`, cfg.grantWindowSec, now)) >= cfg.maxGrantsPerNetwork) reasons.push("network_grant_burst");
  if (s.deviceKey && (await store.peek(`grant:dev:${s.deviceKey}`, cfg.grantWindowSec, now)) >= cfg.maxGrantsPerDevice) reasons.push("device_grant_burst");
  if (reasons.length) {
    // Account stays usable; only the free credits are held back.
    await audit(store, { type: "credits.initial_withheld", decision: "RESTRICT", subject: s.userId, reasons });
    return "withheld";
  }

  const inserted = await store.insertCredit({
    id: crypto.randomUUID(), userId: s.userId, kind: "initial_grant", amount: cfg.initialAmount,
    idempotencyKey: `initial_grant:${s.userId}`, reason: "Welcome credits", createdAt: now,
  });
  if (!inserted) return "duplicate";
  if (s.networkKey) await store.hit(`grant:net:${s.networkKey}`, cfg.grantWindowSec, now);
  if (s.deviceKey) await store.hit(`grant:dev:${s.deviceKey}`, cfg.grantWindowSec, now);
  await audit(store, { type: "credits.initial_granted", decision: "ALLOW", subject: s.userId, details: { amount: cfg.initialAmount } });
  return "granted";
}
