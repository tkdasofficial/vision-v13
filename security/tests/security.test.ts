import { describe, expect, it, beforeEach } from "vitest";
import { MemoryStore } from "../storage/memory-store";
import {
  evaluateSignup, recordAccountCreated, evaluateRisk, enforceLimits, RateLimitError, grantInitialCredits, redact,
  isSameOriginRequest, extractClientIp, networkPrefix, normalizeEmail, isValidEmail, canonicalEmail, checkMailDomain,
  randomDigits, isRestricted, restrict, SECURITY_CONFIG, type RequestFacts, type SignupKeys,
} from "../index";
import { clearDnsCache } from "../identity/dns";

const NOW = 1_800_000_000;
const human: RequestFacts = { ip: "203.0.113.5", userAgent: "Mozilla/5.0 Chrome/130", acceptLanguage: "en-US", secFetchSite: "same-origin", origin: "https://app.test", host: "app.test", deviceId: "d1" };
const keys = (o: Partial<SignupKeys> = {}): SignupKeys => ({ ipKey: "ip1", networkKey: "net1", deviceKey: "dev1", emailKey: "e1", ...o });
const okDns = async () => "mx" as const;

let store: MemoryStore;
beforeEach(() => { store = new MemoryStore(); clearDnsCache(); });

describe("signup protection", () => {
  it("allows a normal email signup", async () => {
    const v = await evaluateSignup(store, { entry: "email", email: "a@example.com", req: human, hints: { elapsedMs: 8000 }, keys: keys(), checkDns: okDns }, NOW);
    expect(v.allowed).toBe(true);
    expect(v.decision).toBe("ALLOW");
  });

  it("allows a normal OAuth signup", async () => {
    const v = await evaluateSignup(store, { entry: "oauth", email: "a@gmail.com", req: human, keys: keys() }, NOW);
    expect(v.allowed).toBe(true);
  });

  it("rate-limits repeated signups from one IP even with new devices (incognito / cookie deletion)", async () => {
    let last;
    for (let i = 0; i < 11; i++)
      last = await evaluateSignup(store, { entry: "email", email: `u${i}@example.com`, req: human, keys: keys({ deviceKey: `fresh${i}`, emailKey: `e${i}` }), checkDns: okDns }, NOW);
    expect(last!.allowed).toBe(false);
    expect(last!.reasons).toContain("rate_limit");
  });

  it("blocks a filled honeypot combined with automation signals and restricts the device", async () => {
    const bot = { ...human, userAgent: "python-requests/2.31", acceptLanguage: "" };
    const v = await evaluateSignup(store, { entry: "email", email: "b@example.com", req: bot, hints: { honeypot: "x", elapsedMs: 100 }, keys: keys(), checkDns: okDns }, NOW);
    expect(v.allowed).toBe(false);
    expect(await isRestricted(store, [["signup:device", "dev1"]], NOW + 10)).not.toBeNull();
  });

  it("flags device bursts after repeated account creation", async () => {
    for (let i = 0; i < 3; i++) await recordAccountCreated(store, `x${i}@example.com`, keys({ emailKey: `k${i}` }), NOW);
    const v = await evaluateSignup(store, { entry: "email", email: "y@example.com", req: human, keys: keys({ emailKey: "k9" }), checkDns: okDns }, NOW);
    expect(v.reasons).toContain("device_signup_burst");
  });

  it("rejects domains that cannot receive mail but tolerates DNS failures", async () => {
    const bad = await evaluateSignup(store, { entry: "email", email: "a@nope.invalid", req: human, keys: keys(), checkDns: async () => "nxdomain" }, NOW);
    expect(bad.allowed).toBe(false);
    const unknown = await evaluateSignup(new MemoryStore(), { entry: "email", email: "a@slowdns.io", req: human, keys: keys(), checkDns: async () => "unknown" }, NOW);
    expect(unknown.allowed).toBe(true);
  });
});

describe("risk engine and false positives", () => {
  it("a single weak category (VPN/shared network) never blocks", () => {
    const r = evaluateRisk([{ id: "vpn", category: "network", weight: 40 }, { id: "network_signup_burst", category: "network", weight: 25 }]);
    expect(r.decision).toBe("REQUIRE_VERIFICATION");
  });
  it("correlated signals across categories escalate", () => {
    const r = evaluateRisk([{ id: "ua_automation", category: "bot", weight: 25 }, { id: "device_signup_burst", category: "device", weight: 30 }, { id: "disposable_domain", category: "identity", weight: 30 }]);
    expect(r.decision).toBe("RESTRICT");
  });
});

describe("rate limits", () => {
  it("throws after the configured max and resets after the window", async () => {
    const lim = { max: 2, windowSec: 60 };
    await enforceLimits(store, [["k", lim]], NOW);
    await enforceLimits(store, [["k", lim]], NOW);
    await expect(enforceLimits(store, [["k", lim]], NOW)).rejects.toBeInstanceOf(RateLimitError);
    await expect(enforceLimits(store, [["k", lim]], NOW + 61)).resolves.toBeUndefined();
  });
});

describe("restrictions", () => {
  it("expire automatically", async () => {
    await restrict(store, "signup:ip", "ip1", "test", 60, NOW);
    expect(await isRestricted(store, [["signup:ip", "ip1"]], NOW + 30)).not.toBeNull();
    expect(await isRestricted(store, [["signup:ip", "ip1"]], NOW + 61)).toBeNull();
  });
  it("signup restriction does not affect login limits", async () => {
    await restrict(store, "signup:ip", "ip1", "test", 3600, NOW);
    await expect(enforceLimits(store, [["login:ip:ip1", SECURITY_CONFIG.limits.loginPerIp]], NOW)).resolves.toBeUndefined();
  });
});

describe("initial credits", () => {
  const subj = { userId: "u1", emailVerified: true, networkKey: "n", deviceKey: "d", disposableEmail: false };
  it("grants exactly once under concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => grantInitialCredits(store, subj, NOW)));
    expect(results.filter((r) => r === "granted")).toHaveLength(1);
    expect(await store.creditBalance("u1")).toBe(SECURITY_CONFIG.credits.initialAmount);
  });
  it("rejects duplicate claims and unverified accounts", async () => {
    expect(await grantInitialCredits(store, subj, NOW)).toBe("granted");
    expect(await grantInitialCredits(store, subj, NOW)).toBe("duplicate");
    expect(await grantInitialCredits(store, { ...subj, userId: "u2", emailVerified: false }, NOW)).toBe("ineligible");
  });
  it("withholds grants for repeated claims from the same device", async () => {
    for (const id of ["a", "b"]) expect(await grantInitialCredits(store, { ...subj, userId: id }, NOW)).toBe("granted");
    expect(await grantInitialCredits(store, { ...subj, userId: "c" }, NOW)).toBe("withheld");
  });
});

describe("network, identity, cookies", () => {
  it("ignores spoofable forwarding headers", () => {
    expect(extractClientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBeNull();
    expect(extractClientIp(new Headers({ "cf-connecting-ip": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(extractClientIp(new Headers({ "cf-connecting-ip": "not-an-ip" }))).toBeNull();
    expect(networkPrefix("1.2.3.4")).toBe("1.2.3.0/24");
  });
  it("validates and canonicalizes emails", () => {
    expect(isValidEmail(normalizeEmail("  User@Example.COM "))).toBe(true);
    expect(isValidEmail("bad@@x")).toBe(false);
    expect(canonicalEmail("j.o.e+promo@googlemail.com")).toBe("joe@gmail.com");
  });
  it("DNS timeout resolves to unknown", async () => {
    const slow = ((_: unknown, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("abort"))))) as unknown as typeof fetch;
    expect(await checkMailDomain("timeout.test", slow)).toBe("unknown");
  });
  it("blocks cross-site requests", () => {
    expect(isSameOriginRequest(human)).toBe(true);
    expect(isSameOriginRequest({ ...human, secFetchSite: null, origin: "https://evil.test" })).toBe(false);
    expect(isSameOriginRequest({ ...human, secFetchSite: "cross-site" })).toBe(false);
    expect(isSameOriginRequest({ ...human, secFetchSite: null, origin: "https://auth.workers.dev" }, ["https://auth.workers.dev"])).toBe(true);
  });
  it("generates uniform 8-digit codes", () => {
    for (let i = 0; i < 100; i++) expect(randomDigits(8)).toMatch(/^\d{8}$/);
  });
});

describe("audit redaction", () => {
  it("never keeps secrets, codes, or full emails", () => {
    const r = redact({ password: "p", otp: "12345678", token: "t", note: "user alice@example.com from 10.1.2.3" }) as any;
    expect(r.password).toBe("[redacted]");
    expect(r.otp).toBe("[redacted]");
    expect(r.token).toBe("[redacted]");
    expect(r.note).toBe("user a***@example.com from 10.1.2.x");
  });
});
