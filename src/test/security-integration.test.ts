// @vitest-environment node
// Integration tests against an ISOLATED in-memory SQLite database loaded with the real db/schema.sql
// (same SQL dialect as D1). No live database, email or OAuth provider is touched: D1 transport,
// cookies and SMTP are mocked; all SQL, hashing and security logic runs for real.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ db: null as any, cookies: new Map<string, string>(), mail: [] as string[] }));

vi.mock("@/lib/cloud/d1.server", () => ({
  d1: async (sql: string, params: unknown[] = []) => {
    const stmt = state.db.prepare(sql);
    const p = params.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v));
    return /^\s*(select|with)|returning/i.test(sql) ? stmt.all(...p) : (stmt.run(...p), []);
  },
}));
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (n: string) => state.cookies.get(n),
  setCookie: (n: string, v: string) => state.cookies.set(n, v),
  deleteCookie: (n: string) => state.cookies.delete(n),
  getRequest: () => new Request("https://app.test/", { headers: { host: "app.test" } }),
}));
vi.mock("@/lib/cloud/mail.server", () => ({ sendMail: async (_to: string, _s: string, text: string) => { state.mail.push(text); } }));

import { sendOtp, checkOtp } from "@/lib/cloud/otp.server";
import { startSession, endSession, getCaller, createUser, SESSION_COOKIE, rateLimit } from "@/lib/cloud/auth.server";
import { d1Store, keysFor, factsFrom } from "@/lib/cloud/security.server";
import { runQuery } from "@/lib/cloud/query.server";
import { evaluateSignup, grantInitialCredits, enforceLimits, SECURITY_CONFIG, oauthLinkMustResetPassword } from "../../security";

const now = () => Math.floor(Date.now() / 1000);
const lastCode = () => /\b(\d{8})\b/.exec(state.mail.at(-1)!)![1]!;

beforeEach(() => {
  process.env["CLOUDFLARE_API_TOKEN"] = "test-only-key";
  state.db = new DatabaseSync(":memory:");
  state.db.exec(readFileSync("db/schema.sql", "utf8"));
  state.cookies.clear();
  state.mail = [];
});

describe("OTP (real SQL, isolated DB)", () => {
  it("stores only a keyed hash, never the code", async () => {
    await sendOtp("a@example.com");
    const row = state.db.prepare("SELECT code_hash FROM auth_otps").get();
    expect(row.code_hash).not.toContain(lastCode());
  });
  it("is single-use (replay rejected)", async () => {
    await sendOtp("a@example.com");
    const code = lastCode();
    expect(await checkOtp("a@example.com", code)).toBe(true);
    expect(await checkOtp("a@example.com", code)).toBe(false);
  });
  it("concurrent verifications succeed at most once", async () => {
    await sendOtp("a@example.com");
    const code = lastCode();
    const r = await Promise.all([1, 2, 3].map(() => checkOtp("a@example.com", code)));
    expect(r.filter(Boolean)).toHaveLength(1);
  });
  it("locks after the attempt limit, even for the correct code", async () => {
    await sendOtp("a@example.com");
    const code = lastCode();
    const wrong = code === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < SECURITY_CONFIG.otp.maxAttempts; i++) expect(await checkOtp("a@example.com", wrong)).toBe(false);
    expect(await checkOtp("a@example.com", code)).toBe(false);
  });
  it("rejects expired codes", async () => {
    await sendOtp("a@example.com");
    state.db.prepare("UPDATE auth_otps SET expires_at = ?").run(now() - 1);
    expect(await checkOtp("a@example.com", lastCode())).toBe(false);
  });
});

describe("password reset codes", () => {
  it("are separate from sign-up codes and single-use", async () => {
    await sendOtp("r@example.com", "reset");
    const code = lastCode();
    expect(state.mail.at(-1)).toContain("password reset");
    expect(await checkOtp("r@example.com", code, "verify")).toBe(false);
    expect(await checkOtp("r@example.com", code, "reset")).toBe(true);
    expect(await checkOtp("r@example.com", code, "reset")).toBe(false);
  });
});

describe("sessions (real SQL, isolated DB)", () => {
  it("stores hashed tokens, rotates on sign-in, revokes on sign-out", async () => {
    const u = await createUser("s@example.com", { password: "password123" });
    await startSession(u.id);
    const t1 = state.cookies.get(SESSION_COOKIE)!;
    expect(state.db.prepare("SELECT COUNT(*) n FROM auth_sessions WHERE token_hash = ?").get(t1).n).toBe(0);
    expect((await getCaller())?.user.id).toBe(u.id);
    await startSession(u.id); // rotation removes the previous token
    expect(state.cookies.get(SESSION_COOKIE)).not.toBe(t1);
    expect(state.db.prepare("SELECT COUNT(*) n FROM auth_sessions").get().n).toBe(1);
    state.cookies.set(SESSION_COOKIE, t1);
    expect(await getCaller()).toBeNull(); // old token is dead
    state.cookies.clear();
    await startSession(u.id); // a second device
    await endSession();
    expect(await getCaller()).toBeNull();
    // Only the signed-out device's session is removed; the other device stays signed in.
    expect(state.db.prepare("SELECT COUNT(*) n FROM auth_sessions").get().n).toBe(1);
  });
  it("caps concurrent sessions and rejects expired / banned sessions", async () => {
    const u = await createUser("c@example.com", { password: "password123" });
    for (let i = 0; i < 13; i++) { state.cookies.clear(); await startSession(u.id); }
    expect(state.db.prepare("SELECT COUNT(*) n FROM auth_sessions").get().n).toBe(SECURITY_CONFIG.session.maxConcurrent);
    expect(await getCaller()).not.toBeNull();
    state.db.prepare("UPDATE profiles SET is_banned = 1").run();
    expect(await getCaller()).toBeNull();
    state.db.prepare("UPDATE profiles SET is_banned = 0").run();
    state.db.prepare("UPDATE auth_sessions SET expires_at = ?").run(now() - 1);
    expect(await getCaller()).toBeNull();
  });
  it("garbage or missing session cookies are rejected", async () => {
    state.cookies.set(SESSION_COOKIE, "forged");
    expect(await getCaller()).toBeNull();
  });
});

describe("D1 security store (real SQL, isolated DB)", () => {
  it("counters are atomic and reset after the window", async () => {
    const counts = await Promise.all(Array.from({ length: 5 }, () => d1Store.hit("k", 60, 1000)));
    expect([...counts].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await d1Store.hit("k", 60, 1061)).toBe(1);
  });
  it("legacy rateLimit uses the same durable counter", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("x", 3, 60);
    await expect(rateLimit("x", 3, 60)).rejects.toThrow(/Too many/);
  });
  it("welcome credits are granted once per account under concurrency and retries", async () => {
    const s = { userId: "u1", emailVerified: true, networkKey: "n", deviceKey: "d", disposableEmail: false };
    const r = await Promise.all(Array.from({ length: 6 }, () => grantInitialCredits(d1Store, s)));
    expect(r.filter((x) => x === "granted")).toHaveLength(1);
    expect(await grantInitialCredits(d1Store, s)).toBe("duplicate");
    expect(await d1Store.creditBalance("u1")).toBe(SECURITY_CONFIG.credits.initialAmount);
    // The DB constraint itself blocks a second initial grant with a different idempotency key.
    expect(() => state.db.prepare("INSERT INTO credit_ledger (id,user_id,kind,amount,idempotency_key,created_at) VALUES ('x','u1','initial_grant',100,'other',0)").run()).toThrow();
  });
  it("restrictions expire and signup restriction leaves login limits untouched", async () => {
    await d1Store.putRestriction({ scope: "signup:ip", subject: "ip1", reason: "t", expiresAt: 2000 });
    expect(await d1Store.getRestriction("signup:ip", "ip1", 1500)).not.toBeNull();
    expect(await d1Store.getRestriction("signup:ip", "ip1", 2001)).toBeNull();
    await expect(enforceLimits(d1Store, [["login:ip:ip1", SECURITY_CONFIG.limits.loginPerIp]], 1500)).resolves.toBeUndefined();
  });
  it("cookie deletion / new device does not reset IP-based signup limits", async () => {
    const h = new Headers({ "cf-connecting-ip": "198.51.100.7", "user-agent": "Mozilla/5.0", "accept-language": "en" });
    let last;
    for (let i = 0; i < SECURITY_CONFIG.limits.signupPerIp.max + 1; i++) {
      const facts = factsFrom(h, `device${i}`);
      last = await evaluateSignup(d1Store, { entry: "email", email: `n${i}@example.com`, req: facts, keys: await keysFor(facts, `n${i}@example.com`), checkDns: async () => "mx" });
    }
    expect(last!.allowed).toBe(false);
  });
  it("spoofed X-Forwarded-For cannot pick a fresh IP bucket", async () => {
    const a = factsFrom(new Headers({ "x-forwarded-for": "1.1.1.1" }), null);
    const b = factsFrom(new Headers({ "x-forwarded-for": "2.2.2.2" }), null);
    expect(a.ip).toBeNull();
    expect((await keysFor(a, "z@x.com")).ipKey).toBe((await keysFor(b, "z@x.com")).ipKey);
  });
  it("stored identifiers are pseudonymous", async () => {
    const facts = factsFrom(new Headers({ "cf-connecting-ip": "203.0.113.9" }), "dev");
    const k = await keysFor(facts, "p@example.com");
    expect(JSON.stringify(k)).not.toMatch(/203\.0\.113|p@example/);
  });
});

describe("direct data API calls (bypassing the UI)", () => {
  const spec = (table: string, action: any = "select", payload: any = null) => ({ table, action, payload, upsertKey: null, filters: [], orders: [], limit: null, rangeFrom: null, rangeTo: null, mode: "many" as const, count: false, head: false, returning: true });
  it("security, session and credit tables are not reachable", async () => {
    const caller = { user: { id: "u", email: "u@x.com", created_at: "", user_metadata: {}, app_metadata: {} }, isAdmin: false };
    for (const t of ["auth_users", "auth_sessions", "auth_otps", "credit_ledger", "security_events", "security_restrictions", "auth_rate_limits"]) {
      const r = await runQuery(spec(t), caller);
      expect(r.error).not.toBeNull();
    }
    const ins = await runQuery(spec("credit_ledger", "insert", { user_id: "u", amount: 999 }), caller);
    expect(ins.error).not.toBeNull();
  });
  it("non-admins cannot grant themselves admin or unban themselves", async () => {
    const u = await createUser("first@example.com", { password: "password123" }); // first = admin
    const v = await createUser("second@example.com", { password: "password123" });
    const caller = { user: { id: v.id, email: v.email, created_at: "", user_metadata: {}, app_metadata: {} }, isAdmin: false };
    expect((await runQuery(spec("user_roles", "insert", { user_id: v.id, role: "admin" }), caller)).error).not.toBeNull();
    state.db.prepare("UPDATE profiles SET is_banned = 1 WHERE id = ?").run(v.id);
    await runQuery({ ...spec("profiles", "update", { is_banned: false }), filters: [{ col: "id", op: "eq", val: v.id }] }, caller);
    expect(state.db.prepare("SELECT is_banned FROM profiles WHERE id = ?").get(v.id).is_banned).toBe(1);
    expect(u.id).not.toBe(v.id);
  });
});

describe("OAuth account linking", () => {
  it("discards an unverified password before linking (pre-hijack defense)", () => {
    expect(oauthLinkMustResetPassword({ email_verified: 0, password_hash: "h" })).toBe(true);
    expect(oauthLinkMustResetPassword({ email_verified: 1, password_hash: "h" })).toBe(false);
    expect(oauthLinkMustResetPassword({ email_verified: 0, password_hash: null })).toBe(false);
  });
});
