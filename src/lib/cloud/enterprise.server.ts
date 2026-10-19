// Server-only Enterprise Login (VISION BDI): domain verification -> enterprise email -> email OTP -> session.
// All state lives in D1, keyed by an HttpOnly attempt cookie; the browser never holds verification results.
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { d1 } from "./d1.server";
import { createUser, randomToken, sha256, startSession, getCaller } from "./auth.server";
import { sendOtp, checkOtp } from "./otp.server";
import { d1Store, keysFor, assertSameOrigin, currentFacts, grantWelcomeCredits } from "./security.server";
import {
  normalizeDomain, normalizeEnterpriseName, emailMatchesDomain, inspectDomain, checkTxtChallenge, txtRecordName,
  normalizeEmail, isValidEmail, enforceLimits, evaluateSignup, recordAccountCreated, audit, nowSec, type DomainReport,
} from "../../../security";
import { ORG_SIZES, ENTERPRISE_ROLES } from "../onboarding-options";

export const ATTEMPT_COOKIE = "vision_ent";
const ATTEMPT_TTL = 60 * 60;
const MAX_TXT_CHECKS = 20;
const L = {
  start: { ip: { max: 10, windowSec: 3600 }, domain: { max: 10, windowSec: 3600 } },
  check: { ip: { max: 60, windowSec: 3600 } },
  email: { ip: { max: 10, windowSec: 3600 }, email: { max: 5, windowSec: 900 } },
  verify: { ip: { max: 30, windowSec: 900 }, attempt: { max: 10, windowSec: 900 } },
};

type Attempt = { id: string; enterprise_name: string; domain: string; challenge: string; status: "pending" | "domain_verified" | "otp_sent"; email: string | null; checks: number; expires_at: number };

export class EnterpriseError extends Error {}
const fail = (m: string): never => { throw new EnterpriseError(m); };

async function currentAttempt(): Promise<Attempt | null> {
  const token = getCookie(ATTEMPT_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return (await d1<Attempt>("SELECT * FROM enterprise_attempts WHERE token_hash = ? AND expires_at > ?", [await sha256(token), nowSec()]))[0] ?? null;
}

async function guard() {
  const facts = currentFacts();
  try { assertSameOrigin(facts); } catch (e) { fail((e as Error).message); }
  return facts;
}

async function limit(checks: [string | null, { max: number; windowSec: number }][]) {
  try { await enforceLimits(d1Store, checks); } catch (e) { fail((e as Error).message); }
}

export type EnterpriseState = {
  step: "identity" | "domain" | "email" | "otp";
  enterpriseName?: string;
  domain?: string;
  txtName?: string;
  txtValue?: string;
  email?: string;
};

export async function getState(): Promise<EnterpriseState> {
  const a = await currentAttempt();
  if (!a) return { step: "identity" };
  const base = { enterpriseName: a.enterprise_name, domain: a.domain };
  if (a.status === "pending") return { step: "domain", ...base, txtName: txtRecordName(a.domain), txtValue: a.challenge };
  if (a.status === "domain_verified") return { step: "email", ...base };
  return { step: "otp", ...base, email: a.email ?? undefined };
}

/** Step 1: validate name + domain, inspect DNS/HTTPS, and issue (or skip, for an already-verified enterprise) a TXT challenge. */
export async function start(rawName: unknown, rawDomain: unknown): Promise<EnterpriseState & { report?: DomainReport }> {
  const facts = await guard();
  const name = normalizeEnterpriseName(rawName) ?? fail("Enter your enterprise name (2–120 characters).");
  const domain = normalizeDomain(rawDomain) ?? fail("Enter a valid domain, like example.com.");
  const keys = await keysFor(facts, `x@${domain}`);
  await limit([[keys.ipKey && `ent:start:ip:${keys.ipKey}`, L.start.ip], [`ent:start:dom:${domain}`, L.start.domain]]);

  const report = await inspectDomain(domain, name);
  if (!report.resolves) fail("We couldn't find that domain. Check the spelling and try again.");
  if (!report.hasMx) fail("That domain can't receive email, so it can't be used for Enterprise Login.");

  const known = (await d1<{ enterprise_name: string }>("SELECT enterprise_name FROM enterprise_domains WHERE domain = ?", [domain]))[0];
  if (known && known.enterprise_name.toLowerCase() !== name.toLowerCase())
    fail("That domain is registered to a different enterprise name. Check the name and try again.");

  const token = randomToken(32);
  const now = nowSec();
  const status = known ? "domain_verified" : "pending";
  const challenge = `vision-verify=${randomToken(16)}`;
  await d1(
    "INSERT INTO enterprise_attempts (id, token_hash, enterprise_name, domain, challenge, status, checks, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [crypto.randomUUID(), await sha256(token), known?.enterprise_name ?? name, domain, challenge, status, now, now + ATTEMPT_TTL],
  );
  setCookie(ATTEMPT_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: ATTEMPT_TTL });
  await audit(d1Store, { type: "enterprise.start", details: { domain, nameMatch: report.nameMatch, https: report.https, known: !!known } });
  if (Math.random() < 0.05) await d1("DELETE FROM enterprise_attempts WHERE expires_at < ?", [now]);
  // The cookie was just set on the response, so build the state directly.
  const ename = known?.enterprise_name ?? name;
  return status === "pending"
    ? { step: "domain", enterpriseName: ename, domain, txtName: txtRecordName(domain), txtValue: challenge, report }
    : { step: "email", enterpriseName: ename, domain, report };
}

/** Step 1b: check the TXT record directly via DNS. */
export async function checkDomain(): Promise<EnterpriseState> {
  const facts = await guard();
  const a = (await currentAttempt()) ?? fail("Your session expired. Please start again.");
  if (a.status !== "pending") return getState();
  const keys = await keysFor(facts, `x@${a.domain}`);
  await limit([[keys.ipKey && `ent:check:ip:${keys.ipKey}`, L.check.ip]]);
  const bumped = await d1<{ checks: number }>("UPDATE enterprise_attempts SET checks = checks + 1 WHERE id = ? AND checks < ? RETURNING checks", [a.id, MAX_TXT_CHECKS]);
  if (!bumped[0]) fail("Too many checks. Please start again.");
  const r = await checkTxtChallenge(a.domain, a.challenge);
  if (r === "unknown") fail("We couldn't reach DNS right now. Please try again in a moment.");
  if (r === "missing") fail("We couldn't find the TXT record yet. DNS changes can take a few minutes — try again shortly.");
  // Atomic: only the first verified attempt for a new domain registers it.
  await d1("INSERT OR IGNORE INTO enterprise_domains (domain, enterprise_name, verified_at) VALUES (?, ?, ?)", [a.domain, a.enterprise_name, nowSec()]);
  const owner = (await d1<{ enterprise_name: string }>("SELECT enterprise_name FROM enterprise_domains WHERE domain = ?", [a.domain]))[0];
  if (owner?.enterprise_name.toLowerCase() !== a.enterprise_name.toLowerCase()) fail("That domain is registered to a different enterprise name.");
  await d1("UPDATE enterprise_attempts SET status = 'domain_verified', enterprise_name = ? WHERE id = ? AND status = 'pending'", [owner!.enterprise_name, a.id]);
  await audit(d1Store, { type: "enterprise.domain_verified", decision: "ALLOW", details: { domain: a.domain } });
  return getState();
}

/** Step 2: bind an email on the verified domain to this attempt and send an attempt-bound OTP. */
export async function submitEmail(rawEmail: unknown): Promise<EnterpriseState> {
  const facts = await guard();
  const a = (await currentAttempt()) ?? fail("Your session expired. Please start again.");
  if (a.status === "pending") fail("Verify your domain first.");
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) fail("Enter a valid email address.");
  if (!emailMatchesDomain(email, a.domain)) fail(`Use your work email ending in @${a.domain}.`);
  const keys = await keysFor(facts, email);
  await limit([[keys.ipKey && `ent:email:ip:${keys.ipKey}`, L.email.ip], [`ent:email:e:${keys.emailKey}`, L.email.email]]);

  const user = (await d1<{ id: string }>("SELECT id FROM auth_users WHERE email = ?", [email]))[0];
  if (!user) {
    // New account: same signup abuse policy as every other entry point.
    const verdict = await evaluateSignup(d1Store, { entry: "email", email, req: facts, keys });
    if (!verdict.allowed) fail(verdict.userMessage ?? "Please try again later.");
  }
  await d1("UPDATE enterprise_attempts SET status = 'otp_sent', email = ? WHERE id = ?", [email, a.id]);
  try {
    await sendOtp(email, `enterprise:${a.id}`);
  } catch (e) {
    console.error("[enterprise] otp send failed", (e as Error).message);
    fail("Couldn't send the email. Please try again in a moment.");
  }
  return getState();
}

export async function resend(): Promise<EnterpriseState> {
  const facts = await guard();
  const a = (await currentAttempt()) ?? fail("Your session expired. Please start again.");
  if (a.status !== "otp_sent" || !a.email) fail("Enter your work email first.");
  const keys = await keysFor(facts, a.email!);
  await limit([[`otpr:email:${keys.emailKey}`, { max: 3, windowSec: 900 }], [keys.ipKey && `otpr:ip:${keys.ipKey}`, { max: 10, windowSec: 3600 }]]);
  try { await sendOtp(a.email!, `enterprise:${a.id}`); } catch { fail("Couldn't send the email. Please try again in a moment."); }
  return getState();
}

/** Step 3: verify the attempt-bound OTP, then sign in (existing member) or activate a new enterprise account. */
export async function verify(rawCode: unknown): Promise<{ redirect: string }> {
  const facts = await guard();
  const a = (await currentAttempt()) ?? fail("Your session expired. Please start again.");
  if (a.status !== "otp_sent" || !a.email) fail("Enter your work email first.");
  const code = String(rawCode ?? "").trim();
  if (!/^\d{8}$/.test(code)) fail("Enter the 8-digit code from your email.");
  const email = a.email!;
  const keys = await keysFor(facts, email);
  await limit([[keys.ipKey && `otpv:ip:${keys.ipKey}`, L.verify.ip], [`ent:verify:${a.id}`, L.verify.attempt]]);
  if (!(await checkOtp(email, code, `enterprise:${a.id}`))) {
    if (keys.ipKey) await d1Store.hit(`vfail:ip:${keys.ipKey}`, 3600, nowSec());
    await audit(d1Store, { type: "enterprise.otp_failed", decision: "DENY", subject: keys.emailKey });
    fail("That code is incorrect or expired.");
  }
  // The attempt is consumed: it can't be replayed or moved to another email/domain.
  const consumed = await d1("DELETE FROM enterprise_attempts WHERE id = ? RETURNING id", [a.id]);
  deleteCookie(ATTEMPT_COOKIE, { path: "/" });
  if (!consumed[0]) fail("This sign-in was already completed. Please start again.");

  const user = (await d1<any>("SELECT u.id, p.is_banned FROM auth_users u LEFT JOIN profiles p ON p.id = u.id WHERE u.email = ?", [email]))[0];
  if (user) {
    if (user.is_banned) fail("This account has been suspended.");
    const m = (await d1<{ domain: string; onboarded: number }>("SELECT domain, onboarded FROM enterprise_members WHERE user_id = ?", [user.id]))[0];
    if (!m) fail("This email belongs to a personal Vision account. Please sign in with your password, Google or GitHub.");
    if (m!.domain !== a.domain) fail("This account belongs to a different enterprise.");
    await d1("UPDATE auth_users SET email_verified = 1 WHERE id = ?", [user.id]);
    await startSession(user.id);
    await audit(d1Store, { type: "enterprise.login", decision: "ALLOW", subject: user.id });
    return { redirect: m!.onboarded ? "/chat" : "/enterprise/getting-started" };
  }

  let row: any;
  try {
    row = await createUser(email, { metadata: { org_type: "Enterprise", enterprise: a.enterprise_name } });
  } catch {
    fail("This account was just created. Please sign in again."); // concurrent duplicate hit UNIQUE(email)
  }
  const now = nowSec();
  await d1("UPDATE auth_users SET email_verified = 1 WHERE id = ?", [row.id]);
  await d1("INSERT INTO enterprise_members (user_id, domain, email, enterprise_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [row.id, a.domain, email, a.enterprise_name, now, now]);
  // Enterprise users never inherit platform admin, even if they were the first account.
  await d1("DELETE FROM user_roles WHERE user_id = ? AND role = 'admin'", [row.id]);
  await recordAccountCreated(d1Store, email, keys);
  await grantWelcomeCredits(row.id, email, facts);
  await startSession(row.id);
  await audit(d1Store, { type: "enterprise.account_created", decision: "ALLOW", subject: row.id });
  return { redirect: "/enterprise/getting-started" };
}

export async function cancel() {
  await guard();
  const token = getCookie(ATTEMPT_COOKIE);
  if (token) await d1("DELETE FROM enterprise_attempts WHERE token_hash = ?", [await sha256(token)]);
  deleteCookie(ATTEMPT_COOKIE, { path: "/" });
}

export type EnterpriseProfile = { enterpriseName: string; domain: string; orgType: string; companySize: string | null; role: string | null; businessPhone: string | null; phoneVerified: boolean; onboarded: boolean; address: Record<string, string | null> };

export async function getProfile(): Promise<EnterpriseProfile | null> {
  const c = await getCaller();
  if (!c) return null;
  const m = (await d1<any>("SELECT * FROM enterprise_members WHERE user_id = ?", [c.user.id]))[0];
  if (!m) return null;
  return {
    enterpriseName: m.enterprise_name, domain: m.domain, orgType: m.org_type, companySize: m.company_size, role: m.role,
    businessPhone: m.business_phone, phoneVerified: !!m.phone_verified, onboarded: !!m.onboarded,
    address: { street: m.street, city: m.city, region: m.region, postal_code: m.postal_code, country: m.country },
  };
}

const PHONE = /^\+?[0-9 ()-]{7,20}$/;
export type OnboardingInput = { companySize: string; role: string; businessPhone: string; street?: string; city?: string; region?: string; postalCode?: string; country?: string };

/** Saves onboarding for the signed-in enterprise member only. Enterprise name, domain and org type are never taken from input. */
export async function completeOnboarding(input: OnboardingInput) {
  await guard();
  const c = (await getCaller()) ?? fail("Please sign in to continue.");
  const m = (await d1<any>("SELECT u.email, u.email_verified, e.domain FROM enterprise_members e JOIN auth_users u ON u.id = e.user_id WHERE e.user_id = ?", [c.user.id]))[0];
  if (!m) fail("This page is only for enterprise accounts.");
  if (!m.email_verified || !emailMatchesDomain(m.email, m.domain)) fail("Your enterprise email isn't verified.");
  const domainOk = (await d1("SELECT 1 FROM enterprise_domains WHERE domain = ?", [m.domain]))[0];
  if (!domainOk) fail("Your enterprise domain is no longer verified.");
  if (!ORG_SIZES.includes(input?.companySize)) fail("Choose your company size.");
  if (!ENTERPRISE_ROLES.includes(input?.role)) fail("Choose your role.");
  const phone = String(input?.businessPhone ?? "").trim();
  if (!PHONE.test(phone) || phone.replace(/\D/g, "").length < 7) fail("Enter a valid business phone number.");
  const clip = (v: unknown, n: number) => { const s = String(v ?? "").trim().slice(0, n); return s || null; };
  const now = nowSec();
  await d1(
    `UPDATE enterprise_members SET org_type = 'Enterprise', company_size = ?, role = ?, business_phone = ?, phone_verified = 0,
       street = ?, city = ?, region = ?, postal_code = ?, country = ?, onboarded = 1, updated_at = ? WHERE user_id = ?`,
    [input.companySize, input.role, phone, clip(input.street, 200), clip(input.city, 100), clip(input.region, 100), clip(input.postalCode, 20), clip(input.country, 100), now, c.user.id],
  );
  const meta = (await d1<{ user_metadata: string }>("SELECT user_metadata FROM auth_users WHERE id = ?", [c.user.id]))[0];
  let md: Record<string, unknown> = {};
  try { md = JSON.parse(meta?.user_metadata || "{}"); } catch { /* ignore */ }
  await d1("UPDATE auth_users SET user_metadata = ? WHERE id = ?", [JSON.stringify({ ...md, org_type: "Enterprise", org_size: input.companySize, role: input.role, onboarded: "true" }), c.user.id]);
  return { redirect: "/chat" };
}
