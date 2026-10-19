// Signup pipeline used by every account-creation entry point (email form and OAuth).
import type { ClientHints, DnsStatus, EntryPoint, RequestFacts, RiskResult, RiskSignal, SecurityStore } from "../types";
import { SECURITY_CONFIG } from "../config";
import { botSignals } from "../antibot/bot-detection";
import { canonicalEmail, emailDomain, isDisposableDomain } from "../identity/email";
import { evaluateRisk, blocks } from "../risk/risk-engine";
import { enforceLimits, nowSec } from "../rate-limits/rate-limit-engine";
import { isRestricted, restrict } from "../enforcement/restrictions";
import { audit } from "../audit/audit-logger";
import { sha256Hex } from "../utils/crypto";

export type SignupKeys = { ipKey: string | null; networkKey: string | null; deviceKey: string | null; emailKey: string };

export type SignupInput = {
  entry: EntryPoint;
  email: string;
  req: RequestFacts;
  hints?: ClientHints;
  keys: SignupKeys;
  checkDns?: (domain: string) => Promise<DnsStatus>;
};

export type SignupVerdict = RiskResult & { allowed: boolean; userMessage: string | null };

const GENERIC = "We couldn't create your account right now. Please try again later.";

export async function evaluateSignup(store: SecurityStore, input: SignupInput, now = nowSec()): Promise<SignupVerdict> {
  const { keys, entry } = input;
  const L = SECURITY_CONFIG.limits;
  const B = SECURITY_CONFIG.burst;

  // 1. Active restrictions (server-side; survive cookie deletion and incognito via IP/email keys).
  const r = await isRestricted(store, [["signup:ip", keys.ipKey], ["signup:device", keys.deviceKey], ["signup:email", keys.emailKey]], now);
  if (r) {
    await audit(store, { type: "signup.blocked_restricted", decision: "TEMPORARILY_LIMIT", reasons: [r.reason], details: { entry } });
    return { decision: "TEMPORARILY_LIMIT", score: 0, reasons: ["active_restriction"], allowed: false, userMessage: GENERIC };
  }

  // 2. Hard rate limits (independent of risk scoring).
  try {
    await enforceLimits(store, [[keys.ipKey && `signup:ip:${keys.ipKey}`, L.signupPerIp], [`signup:email:${keys.emailKey}`, L.signupPerEmail], [keys.deviceKey && `signup:dev:${keys.deviceKey}`, L.signupPerDevice]], now);
  } catch (e) {
    await audit(store, { type: "signup.rate_limited", decision: "TEMPORARILY_LIMIT", details: { entry } });
    return { decision: "TEMPORARILY_LIMIT", score: 0, reasons: ["rate_limit"], allowed: false, userMessage: (e as Error).message };
  }

  // 3. Signals.
  const signals: RiskSignal[] = botSignals(input.req, input.hints, entry);
  const domain = emailDomain(input.email);
  if (isDisposableDomain(domain)) signals.push({ id: "disposable_domain", category: "identity", weight: 30 });
  if (entry === "email" && input.checkDns) {
    const dns = await input.checkDns(domain);
    if (dns === "nxdomain" || dns === "no_mail") {
      await audit(store, { type: "signup.invalid_domain", decision: "DENY", reasons: [dns] });
      return { decision: "DENY", score: 100, reasons: [dns], allowed: false, userMessage: "That email domain can't receive mail. Please check the address." };
    }
    if (dns === "no_mx_has_a") signals.push({ id: "domain_no_mx", category: "identity", weight: 10 });
  }
  if (keys.networkKey && (await store.peek(`created:net:${keys.networkKey}`, 86400, now)) >= B.networkSignups24h)
    signals.push({ id: "network_signup_burst", category: "network", weight: 25 });
  if (keys.deviceKey && (await store.peek(`created:dev:${keys.deviceKey}`, 86400, now)) >= B.deviceSignups24h)
    signals.push({ id: "device_signup_burst", category: "device", weight: 30 });
  if (await store.peek(`created:canon:${await canonicalKey(input.email)}`, 86400, now) >= 2)
    signals.push({ id: "email_alias_burst", category: "abuse", weight: 20 });
  if (keys.ipKey && (await store.peek(`vfail:ip:${keys.ipKey}`, 3600, now)) >= B.verifyFailures1h)
    signals.push({ id: "verification_failures", category: "abuse", weight: 20 });

  // 4. Decision and enforcement.
  const risk = evaluateRisk(signals);
  if (risk.decision === "RESTRICT" || risk.decision === "DENY") {
    await restrict(store, "signup:ip", keys.ipKey, risk.reasons.join(","), SECURITY_CONFIG.cooldownSec.restrict, now);
    await restrict(store, "signup:device", keys.deviceKey, risk.reasons.join(","), SECURITY_CONFIG.cooldownSec.restrict, now);
  } else if (risk.decision === "TEMPORARILY_LIMIT") {
    await restrict(store, "signup:device", keys.deviceKey ?? keys.ipKey, risk.reasons.join(","), SECURITY_CONFIG.cooldownSec.limit, now);
  }
  await audit(store, { type: "signup.evaluated", decision: risk.decision, reasons: risk.reasons, details: { entry, score: risk.score } });
  const allowed = !blocks(risk.decision);
  return { ...risk, allowed, userMessage: allowed ? null : GENERIC };
}

/** Records a successful account creation for burst / multi-account analysis. */
export async function recordAccountCreated(store: SecurityStore, email: string, keys: SignupKeys, now = nowSec()) {
  if (keys.networkKey) await store.hit(`created:net:${keys.networkKey}`, 86400, now);
  if (keys.deviceKey) await store.hit(`created:dev:${keys.deviceKey}`, 86400, now);
  await store.hit(`created:canon:${await canonicalKey(email)}`, 86400, now);
}

async function canonicalKey(email: string) {
  return (await sha256Hex(canonicalEmail(email))).slice(0, 32);
}
