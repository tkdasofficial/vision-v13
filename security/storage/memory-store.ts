// In-memory SecurityStore for tests. Production uses the D1 store.
import type { Restriction, SecurityEvent, SecurityStore } from "../types";

export class MemoryStore implements SecurityStore {
  counters = new Map<string, { count: number; start: number }>();
  restrictions = new Map<string, Restriction>();
  events: (SecurityEvent & { createdAt: number })[] = [];
  ledger: { id: string; userId: string; kind: string; amount: number; idempotencyKey: string }[] = [];

  async hit(key: string, windowSec: number, now: number) {
    const c = this.counters.get(key);
    if (!c || now - c.start >= windowSec) { this.counters.set(key, { count: 1, start: now }); return 1; }
    c.count++;
    return c.count;
  }
  async peek(key: string, windowSec: number, now: number) {
    const c = this.counters.get(key);
    return !c || now - c.start >= windowSec ? 0 : c.count;
  }
  async getRestriction(scope: string, subject: string, now: number) {
    const r = this.restrictions.get(`${scope}|${subject}`);
    return r && r.expiresAt > now ? r : null;
  }
  async putRestriction(r: Restriction) { this.restrictions.set(`${r.scope}|${r.subject}`, r); }
  async logEvent(e: SecurityEvent & { createdAt: number }) { this.events.push(e); }
  async insertCredit(row: { id: string; userId: string; kind: string; amount: number; idempotencyKey: string }) {
    if (this.ledger.some((l) => l.idempotencyKey === row.idempotencyKey || (row.kind === "initial_grant" && l.kind === row.kind && l.userId === row.userId))) return false;
    this.ledger.push(row);
    return true;
  }
  async creditBalance(userId: string) { return this.ledger.filter((l) => l.userId === userId).reduce((n, l) => n + l.amount, 0); }
}
