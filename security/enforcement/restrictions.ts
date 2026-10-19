// Temporary restrictions with explicit expiry. Signup restrictions never block login of existing accounts.
import type { Restriction, SecurityStore } from "../types";

export type Scope = "signup:ip" | "signup:device" | "signup:email" | "credits:user";

export async function isRestricted(store: SecurityStore, checks: [Scope, string | null][], now: number): Promise<Restriction | null> {
  for (const [scope, subject] of checks) {
    if (!subject) continue;
    const r = await store.getRestriction(scope, subject, now);
    if (r && r.expiresAt > now) return r;
  }
  return null;
}

export async function restrict(store: SecurityStore, scope: Scope, subject: string | null, reason: string, durationSec: number, now: number) {
  if (!subject) return;
  await store.putRestriction({ scope, subject, reason, expiresAt: now + durationSec });
}
