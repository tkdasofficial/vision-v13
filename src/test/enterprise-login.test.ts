// @vitest-environment node
// Enterprise Login against an ISOLATED in-memory SQLite DB with the real schema. DNS (DoH), HTTPS,
// cookies and SMTP are mocked; all flow, SQL, OTP and security logic runs for real.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const state = vi.hoisted(() => ({ db: null as any, cookies: new Map<string, string>(), mail: [] as string[], dns: {} as Record<string, any> }));

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
  getRequest: () => new Request("https://app.test/", { headers: { host: "app.test", "user-agent": "Mozilla/5.0", "accept-language": "en" } }),
}));
vi.mock("@/lib/cloud/mail.server", () => ({ sendMail: async (_t: string, _s: string, text: string) => { state.mail.push(text); } }));

import * as E from "@/lib/cloud/enterprise.server";
import { getCaller, createUser } from "@/lib/cloud/auth.server";
import { normalizeDomain, emailMatchesDomain, isPrivateAddress, compareNameToSite } from "../../security";

const lastCode = () => /\b(\d{8})\b/.exec(state.mail.at(-1)!)![1]!;
const ans = (type: number, data: string) => ({ Status: 0, Answer: [{ type, data }] });

function dnsFor(domain: string, opts: { txt?: string; mx?: boolean; ip?: string } = {}) {
  state.dns[`${domain}|A`] = ans(1, opts.ip ?? "93.184.216.34");
  state.dns[`${domain}|AAAA`] = { Status: 0 };
  state.dns[`${domain}|MX`] = opts.mx === false ? { Status: 0 } : ans(15, `10 mx.${domain}.`);
  if (opts.txt) state.dns[`_vision-verify.${domain}|TXT`] = ans(16, `"${opts.txt}"`);
}

beforeEach(() => {
  process.env["CLOUDFLARE_API_TOKEN"] = "test-only-key";
  state.db = new DatabaseSync(":memory:");
  state.db.exec(readFileSync("db/schema.sql", "utf8"));
  state.cookies.clear();
  state.mail = [];
  state.dns = {};
  vi.stubGlobal("fetch", async (input: string) => {
    const u = new URL(input);
    if (u.hostname === "cloudflare-dns.com") {
      const j = state.dns[`${u.searchParams.get("name")}|${u.searchParams.get("type")}`] ?? { Status: 3 };
      return new Response(JSON.stringify(j), { status: 200 });
    }
    return new Response("<html><title>Acme Corporation</title></html>", { status: 200 });
  });
});

async function verifiedAttempt(domain = "acme.com", name = "Acme Inc") {
  dnsFor(domain);
  const s = await E.start(name, domain);
  dnsFor(domain, { txt: s.txtValue });
  return E.checkDomain();
}

describe("domain helpers", () => {
  it("normalizes domains and rejects unsafe input", () => {
    expect(normalizeDomain("https://WWW.Acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("10.0.0.1")).toBeNull();
    expect(normalizeDomain("intranet.local")).toBeNull();
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(emailMatchesDomain("a@eu.acme.com", "acme.com")).toBe(true);
    expect(emailMatchesDomain("a@notacme.com", "acme.com")).toBe(false);
    expect(compareNameToSite("Acme Inc", "acme.com", "Acme Corporation")).toBe("match");
    expect(compareNameToSite("Globex", "acme.com", "Acme Corporation")).toBe("mismatch");
  });
});

describe("step 1 — domain verification", () => {
  it("rejects invalid, unresolvable and mail-less domains", async () => {
    await expect(E.start("Acme", "not a domain")).rejects.toThrow(/valid domain/);
    await expect(E.start("Acme", "nowhere-zz.com")).rejects.toThrow(/couldn't find/);
    dnsFor("nomail.com", { mx: false });
    await expect(E.start("Acme", "nomail.com")).rejects.toThrow(/receive email/);
  });
  it("a website alone is not proof: TXT challenge is required", async () => {
    dnsFor("acme.com");
    const s = await E.start("Acme Inc", "acme.com");
    expect(s.step).toBe("domain");
    expect(s.report?.https).toBe("ok");
    await expect(E.checkDomain()).rejects.toThrow(/TXT record/);
    await expect(E.submitEmail("me@acme.com")).rejects.toThrow(/Verify your domain/);
  });
  it("blocks SSRF: a domain resolving to a private address is never fetched", async () => {
    dnsFor("evil.com", { ip: "127.0.0.1" });
    const s = await E.start("Evil", "evil.com");
    expect(s.report?.https).toBe("skipped");
  });
  it("verifies via TXT and registers the domain to the enterprise name", async () => {
    const s = await verifiedAttempt();
    expect(s.step).toBe("email");
    expect(state.db.prepare("SELECT enterprise_name FROM enterprise_domains WHERE domain='acme.com'").get().enterprise_name).toBe("Acme Inc");
  });
  it("a verified domain can't be claimed under a different name", async () => {
    await verifiedAttempt();
    state.cookies.clear();
    await expect(E.start("Other Co", "acme.com")).rejects.toThrow(/different enterprise/);
  });
});

describe("steps 2–3 — email + OTP", () => {
  it("requires an email on the verified domain", async () => {
    await verifiedAttempt();
    await expect(E.submitEmail("me@gmail.com")).rejects.toThrow(/@acme.com/);
  });
  it("creates a new passwordless enterprise account only after OTP, without admin rights", async () => {
    await verifiedAttempt();
    await E.submitEmail("ceo@acme.com");
    expect(state.db.prepare("SELECT COUNT(*) n FROM auth_users").get().n).toBe(0); // not before OTP
    await expect(E.verify("00000000")).rejects.toThrow(/incorrect/);
    const r = await E.verify(lastCode());
    expect(r.redirect).toBe("/enterprise/getting-started");
    const u = state.db.prepare("SELECT id, password_hash, email_verified FROM auth_users WHERE email='ceo@acme.com'").get();
    expect(u.password_hash).toBeNull();
    expect(u.email_verified).toBe(1);
    expect(state.db.prepare("SELECT COUNT(*) n FROM user_roles WHERE user_id=? AND role='admin'").get(u.id).n).toBe(0);
    expect((await getCaller())?.user.id).toBe(u.id);
  });
  it("OTP can't be replayed and the attempt is consumed", async () => {
    await verifiedAttempt();
    await E.submitEmail("ceo@acme.com");
    const code = lastCode();
    await E.verify(code);
    await expect(E.verify(code)).rejects.toThrow(/expired/);
  });
  it("an OTP is bound to its attempt (can't be used from another attempt)", async () => {
    await verifiedAttempt();
    await E.submitEmail("ceo@acme.com");
    const code = lastCode();
    const first = state.cookies.get(E.ATTEMPT_COOKIE)!;
    state.cookies.clear();
    await verifiedAttempt(); // domain known now -> straight to email step
    await E.submitEmail("ceo@acme.com");
    state.mail.pop();
    await expect(E.verify(code)).rejects.toThrow(/incorrect/);
    expect(first).not.toBe(state.cookies.get(E.ATTEMPT_COOKIE));
  });
  it("existing onboarded member goes straight to chat; personal accounts aren't converted", async () => {
    await verifiedAttempt();
    await E.submitEmail("ceo@acme.com");
    await E.verify(lastCode());
    await E.completeOnboarding({ companySize: "11–50", role: "Executive", businessPhone: "+1 555 123 4567" });
    state.cookies.clear();
    await verifiedAttempt();
    await E.submitEmail("ceo@acme.com");
    expect((await E.verify(lastCode())).redirect).toBe("/chat");

    await createUser("dev@acme.com", { password: "password123" });
    state.cookies.clear();
    await verifiedAttempt();
    await E.submitEmail("dev@acme.com");
    await expect(E.verify(lastCode())).rejects.toThrow(/personal Vision account/);
    expect(state.db.prepare("SELECT password_hash FROM auth_users WHERE email='dev@acme.com'").get().password_hash).not.toBeNull();
  });
});

describe("enterprise onboarding", () => {
  it("validates input server-side and never lets the user change name/domain/type", async () => {
    await verifiedAttempt();
    await E.submitEmail("ceo@acme.com");
    await E.verify(lastCode());
    await expect(E.completeOnboarding({ companySize: "huge", role: "Executive", businessPhone: "+1 555 123 4567" })).rejects.toThrow(/company size/);
    await expect(E.completeOnboarding({ companySize: "11–50", role: "Platform Admin", businessPhone: "+1 555 123 4567" })).rejects.toThrow(/role/);
    await expect(E.completeOnboarding({ companySize: "11–50", role: "Executive", businessPhone: "abc" })).rejects.toThrow(/phone/);
    await E.completeOnboarding({ companySize: "11–50", role: "Executive", businessPhone: "+1 555 123 4567", enterpriseName: "Hacked", domain: "evil.com" } as any);
    const m = state.db.prepare("SELECT * FROM enterprise_members").get();
    expect([m.enterprise_name, m.domain, m.org_type, m.onboarded, m.phone_verified]).toEqual(["Acme Inc", "acme.com", "Enterprise", 1, 0]);
  });
  it("non-enterprise or signed-out users can't complete onboarding", async () => {
    await expect(E.completeOnboarding({ companySize: "11–50", role: "Executive", businessPhone: "+1 555 123 4567" })).rejects.toThrow(/sign in/);
  });
});
