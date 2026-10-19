import { createServerFn } from "@tanstack/react-start";

type AuthResult = { user: any | null; error: string | null; needsVerification?: boolean };

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getCaller } = await import("./auth.server");
  const c = await getCaller();
  return { user: c?.user ?? null, isAdmin: c?.isAdmin ?? false };
});

type Hints = { honeypot?: string; elapsedMs?: number };

// First step of email auth: validate the address server-side (format, same-origin,
// rate limits, mail-domain DNS) before the password field is shown. The response is
// generic — it never reveals whether an account exists.
export const checkEmailFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    if (!S.isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { ok: false, error: e.message }; }
    const keys = await S.keysFor(facts, email);
    const L = S.SECURITY_CONFIG.limits;
    try {
      await S.enforceLimits(S.d1Store, [[`emailck:email:${keys.emailKey}`, L.loginPerEmail], [keys.ipKey && `emailck:ip:${keys.ipKey}`, L.loginPerIp]]);
    } catch (e: any) { return { ok: false, error: e.message }; }
    const domain = email.split("@")[1];
    const dns = await S.checkMailDomain(domain);
    if (dns === "nxdomain" || dns === "no_mail") {
      return { ok: false, error: "This email address can't receive mail. Check for typos." };
    }
    return { ok: true, error: null };
  });

async function sec() {
  const s = await import("./security.server");
  const core = await import("../../../security");
  return { ...s, ...core };
}

export const signUpFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string; fullName?: string; hints?: Hints }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    const password = typeof data?.password === "string" ? data.password : "";
    if (!S.isValidEmail(email)) return { user: null, error: "Enter a valid email address." };
    if (password.length < 8 || password.length > 128) return { user: null, error: "Password must be 8–128 characters." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { user: null, error: e.message }; }
    const hints: Hints = {
      honeypot: typeof data?.hints?.honeypot === "string" ? data.hints.honeypot.slice(0, 100) : undefined,
      elapsedMs: Number.isFinite(data?.hints?.elapsedMs) ? Number(data.hints!.elapsedMs) : undefined,
    };
    const keys = await S.keysFor(facts, email);
    const verdict = await S.evaluateSignup(S.d1Store, { entry: "email", email, req: facts, hints, keys, checkDns: (d) => S.checkMailDomain(d) });
    if (!verdict.allowed) return { user: null, error: verdict.userMessage };
    const exists = await d1("SELECT id FROM auth_users WHERE email = ?", [email]);
    if (exists[0]) return { user: null, error: "An account with this email already exists." };
    const fullName = String(data.fullName ?? "").trim().slice(0, 100);
    try {
      await a.createUser(email, { password, metadata: fullName ? { full_name: fullName } : {} });
    } catch (e) {
      // Concurrent duplicate signup hits the UNIQUE(email) constraint.
      console.error("[signup] create failed", (e as Error).message);
      return { user: null, error: "An account with this email already exists." };
    }
    await S.recordAccountCreated(S.d1Store, email, keys);
    try {
      const { sendOtp } = await import("./otp.server");
      await sendOtp(email);
    } catch (e) {
      console.error("[signup] otp send failed", (e as Error).message);
      return { user: null, error: "Account created, but we couldn't send the verification email. Please try signing in to resend it." };
    }
    // Session starts only after the email code is verified.
    return { user: null, error: null, needsVerification: true };
  });

export const verifyEmailFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; code: string }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    const code = String(data?.code ?? "").trim();
    if (!S.isValidEmail(email) || !/^\d{8}$/.test(code)) return { user: null, error: "Enter the 8-digit code from your email." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { user: null, error: e.message }; }
    const keys = await S.keysFor(facts, email);
    const L = S.SECURITY_CONFIG.limits;
    try {
      await S.enforceLimits(S.d1Store, [[`otpv:email:${keys.emailKey}`, L.otpVerifyPerEmail], [keys.ipKey && `otpv:ip:${keys.ipKey}`, L.otpVerifyPerIp]]);
    } catch (e: any) { return { user: null, error: e.message }; }
    const { checkOtp } = await import("./otp.server");
    if (!(await checkOtp(email, code))) {
      if (keys.ipKey) await S.d1Store.hit(`vfail:ip:${keys.ipKey}`, 3600, S.nowSec());
      await S.audit(S.d1Store, { type: "otp.failed", decision: "DENY", subject: keys.emailKey });
      return { user: null, error: "That code is incorrect or expired." };
    }
    const row: any = (await d1("SELECT u.*, p.is_banned FROM auth_users u LEFT JOIN profiles p ON p.id = u.id WHERE u.email = ?", [email]))[0];
    if (!row) return { user: null, error: "Account not found. Please sign up again." };
    if (row.is_banned) return { user: null, error: "This account has been suspended." };
    await d1("UPDATE auth_users SET email_verified = 1 WHERE id = ?", [row.id]);
    await S.grantWelcomeCredits(row.id, email, facts);
    await a.startSession(row.id);
    return { user: a.toPublicUser(row), error: null };
  });

export const resendVerificationFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const { d1 } = await import("./d1.server");
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    if (!S.isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { ok: false, error: e.message }; }
    const keys = await S.keysFor(facts, email);
    const L = S.SECURITY_CONFIG.limits;
    try {
      await S.enforceLimits(S.d1Store, [[`otpr:email:${keys.emailKey}`, L.otpResendPerEmail], [keys.ipKey && `otpr:ip:${keys.ipKey}`, L.otpResendPerIp]]);
    } catch (e: any) { return { ok: false, error: e.message }; }
    const row: any = (await d1("SELECT id, email_verified FROM auth_users WHERE email = ?", [email]))[0];
    if (!row || row.email_verified) return { ok: true, error: null }; // don't reveal account state
    try {
      const { sendOtp } = await import("./otp.server");
      await sendOtp(email);
      return { ok: true, error: null };
    } catch (e) {
      console.error("[resend] otp send failed", (e as Error).message);
      return { ok: false, error: "Couldn't send the email. Please try again in a moment." };
    }
  });

export const signInFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    const password = typeof data?.password === "string" ? data.password.slice(0, 256) : "";
    if (!S.isValidEmail(email) || !password) return { user: null, error: "Invalid email or password." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { user: null, error: e.message }; }
    const keys = await S.keysFor(facts, email);
    const L = S.SECURITY_CONFIG.limits;
    // Login limits are separate from signup restrictions, so existing accounts can still sign in.
    try {
      await S.enforceLimits(S.d1Store, [[`login:email:${keys.emailKey}`, L.loginPerEmail], [keys.ipKey && `login:ip:${keys.ipKey}`, L.loginPerIp]]);
    } catch (e: any) { return { user: null, error: e.message }; }
    const row: any = (await d1("SELECT u.*, p.is_banned FROM auth_users u LEFT JOIN profiles p ON p.id = u.id WHERE u.email = ?", [email]))[0];
    // Always run the hash so response timing doesn't reveal whether the account exists.
    const ok = row?.password_hash
      ? await a.verifyPassword(password, row.salt, row.password_hash)
      : (await a.hashPassword(password, "timing-equalizer"), false);
    if (!ok) {
      await S.audit(S.d1Store, { type: "login.failed", decision: "DENY", subject: keys.emailKey });
      return { user: null, error: "Invalid email or password." };
    }
    if (row.is_banned) return { user: null, error: "This account has been suspended." };
    if (!row.email_verified) {
      try {
        await S.enforceLimits(S.d1Store, [[`otpr:email:${keys.emailKey}`, L.otpResendPerEmail]]);
        const { sendOtp } = await import("./otp.server");
        await sendOtp(email);
      } catch (e) { console.error("[signin] otp send skipped", (e as Error).message); }
      return { user: null, error: null, needsVerification: true };
    }
    await a.startSession(row.id);
    return { user: a.toPublicUser(row), error: null };
  });

export const requestPasswordResetFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const { d1 } = await import("./d1.server");
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    if (!S.isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { ok: false, error: e.message }; }
    const keys = await S.keysFor(facts, email);
    const L = S.SECURITY_CONFIG.limits;
    try {
      await S.enforceLimits(S.d1Store, [[`pwreset:email:${keys.emailKey}`, L.otpResendPerEmail], [keys.ipKey && `pwreset:ip:${keys.ipKey}`, L.otpResendPerIp]]);
    } catch (e: any) { return { ok: false, error: e.message }; }
    const row: any = (await d1("SELECT u.id, p.is_banned FROM auth_users u LEFT JOIN profiles p ON p.id = u.id WHERE u.email = ?", [email]))[0];
    // Same answer whether or not the account exists, so emails can't be probed.
    if (!row || row.is_banned) return { ok: true, error: null };
    // Enterprise accounts are passwordless; they sign in through Enterprise Login only.
    const ent = (await d1("SELECT 1 FROM enterprise_members WHERE user_id = ?", [row.id]))[0];
    if (ent) return { ok: true, error: null };
    try {
      const { sendOtp } = await import("./otp.server");
      await sendOtp(email, "reset");
    } catch (e) {
      console.error("[pwreset] send failed", (e as Error).message);
      return { ok: false, error: "Couldn't send the email. Please try again in a moment." };
    }
    await S.audit(S.d1Store, { type: "password.reset_requested", subject: keys.emailKey });
    return { ok: true, error: null };
  });

const RESET_COOKIE = "vision_reset";
const RESET_TTL = 10 * 60;
// SameSite=None + Partitioned so the ticket survives when the app runs inside an embedded preview frame; CSRF is still blocked by assertSameOrigin on every reset step.
const RESET_COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: "none" as const, partitioned: true, path: "/" };

/** Step 1 of reset: checks the emailed code and issues a short-lived, single-use reset ticket (HttpOnly cookie). */
export const verifyResetCodeFn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; code: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; error: string | null }> => {
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const { setCookie } = await import("@tanstack/react-start/server");
    const S = await sec();
    const email = S.normalizeEmail(data?.email);
    const code = String(data?.code ?? "").trim();
    if (!S.isValidEmail(email) || !/^\d{8}$/.test(code)) return { ok: false, error: "Enter the 8-digit code from your email." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { ok: false, error: e.message }; }
    const keys = await S.keysFor(facts, email);
    const L = S.SECURITY_CONFIG.limits;
    try {
      await S.enforceLimits(S.d1Store, [[`otpv:email:${keys.emailKey}`, L.otpVerifyPerEmail], [keys.ipKey && `otpv:ip:${keys.ipKey}`, L.otpVerifyPerIp]]);
    } catch (e: any) { return { ok: false, error: e.message }; }
    const { checkOtp } = await import("./otp.server");
    if (!(await checkOtp(email, code, "reset"))) {
      if (keys.ipKey) await S.d1Store.hit(`vfail:ip:${keys.ipKey}`, 3600, S.nowSec());
      await S.audit(S.d1Store, { type: "password.reset_failed", decision: "DENY", subject: keys.emailKey });
      return { ok: false, error: "That code is incorrect or expired." };
    }
    const row: any = (await d1("SELECT u.id, p.is_banned FROM auth_users u LEFT JOIN profiles p ON p.id = u.id WHERE u.email = ?", [email]))[0];
    if (!row) return { ok: false, error: "That code is incorrect or expired." };
    if (row.is_banned) return { ok: false, error: "This account has been suspended." };
    const now = Math.floor(Date.now() / 1000);
    const ticket = a.randomToken(32);
    // One open ticket per account; the raw token only ever lives in the HttpOnly cookie.
    await d1("DELETE FROM password_reset_tickets WHERE user_id = ? OR expires_at < ?", [row.id, now]);
    await d1("INSERT INTO password_reset_tickets (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [await a.sha256(ticket), row.id, now + RESET_TTL]);
    setCookie(RESET_COOKIE, ticket, { ...RESET_COOKIE_OPTS, maxAge: RESET_TTL });
    await S.audit(S.d1Store, { type: "password.reset_code_verified", decision: "ALLOW", subject: row.id });
    return { ok: true, error: null };
  });

/** Whether this browser holds a valid reset ticket (lets the confirm page send people back if not). */
export const resetTicketStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const a = await import("./auth.server");
  const { d1 } = await import("./d1.server");
  const { getCookie } = await import("@tanstack/react-start/server");
  const ticket = getCookie(RESET_COOKIE);
  if (!ticket) return { valid: false };
  const row = (await d1("SELECT 1 AS ok FROM password_reset_tickets WHERE token_hash = ? AND expires_at >= ?", [await a.sha256(ticket), Math.floor(Date.now() / 1000)]))[0];
  return { valid: !!row };
});

/** Step 2 of reset: consumes the ticket, sets the new password, signs out other devices and signs this one in. */
export const completePasswordResetFn = createServerFn({ method: "POST" })
  .inputValidator((d: { password: string }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");
    const S = await sec();
    const password = typeof data?.password === "string" ? data.password : "";
    if (password.length < 8 || password.length > 128) return { user: null, error: "Password must be 8–128 characters." };
    const facts = S.currentFacts();
    try { S.assertSameOrigin(facts); } catch (e: any) { return { user: null, error: e.message }; }
    const ticket = getCookie(RESET_COOKIE);
    const expired = { user: null, error: "Your reset session expired. Please request a new code." };
    if (!ticket) return expired;
    // Atomic single use: the ticket row is deleted as it is read.
    const t: any = (await d1("DELETE FROM password_reset_tickets WHERE token_hash = ? AND expires_at >= ? RETURNING user_id", [await a.sha256(ticket), Math.floor(Date.now() / 1000)]))[0];
    deleteCookie(RESET_COOKIE, RESET_COOKIE_OPTS);
    if (!t) return expired;
    const row: any = (await d1("SELECT u.*, p.is_banned FROM auth_users u LEFT JOIN profiles p ON p.id = u.id WHERE u.id = ?", [t.user_id]))[0];
    if (!row) return expired;
    if (row.is_banned) return { user: null, error: "This account has been suspended." };
    const salt = a.randomToken(16);
    await d1("UPDATE auth_users SET password_hash = ?, salt = ?, email_verified = 1 WHERE id = ?", [await a.hashPassword(password, salt), salt, row.id]);
    await d1("DELETE FROM auth_sessions WHERE user_id = ?", [row.id]);
    await S.audit(S.d1Store, { type: "password.reset_completed", decision: "ALLOW", subject: row.id });
    await a.startSession(row.id);
    return { user: a.toPublicUser(row), error: null };
  });

export const getCreditBalanceFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getCaller } = await import("./auth.server");
  const c = await getCaller();
  if (!c) return { balance: 0 };
  const { d1Store } = await import("./security.server");
  return { balance: await d1Store.creditBalance(c.user.id) };
});

export const signOutFn = createServerFn({ method: "POST" }).handler(async () => {
  const { endSession } = await import("./auth.server");
  await endSession();
  return { ok: true };
});

export const updateUserFn = createServerFn({ method: "POST" })
  .inputValidator((d: { password?: string; currentPassword?: string; data?: Record<string, any> }) => d)
  .handler(async ({ data }): Promise<AuthResult> => {
    const a = await import("./auth.server");
    const { d1 } = await import("./d1.server");
    const S = await sec();
    try { S.assertSameOrigin(S.currentFacts()); } catch (e: any) { return { user: null, error: e.message }; }
    const c = await a.getCaller();
    if (!c) return { user: null, error: "Please sign in to continue." };
    const row: any = (await d1("SELECT * FROM auth_users WHERE id = ?", [c.user.id]))[0];
    if (data.password !== undefined) {
      if (data.password.length < 8 || data.password.length > 128) return { user: null, error: "Password must be 8–128 characters." };
      if (row.password_hash && !(data.currentPassword && (await a.verifyPassword(data.currentPassword, row.salt, row.password_hash))))
        return { user: null, error: "Your current password is incorrect." };
      const salt = a.randomToken(16);
      await d1("UPDATE auth_users SET password_hash = ?, salt = ? WHERE id = ?", [await a.hashPassword(data.password, salt), salt, c.user.id]);
      // Sign out other devices after a password change.
      await d1("DELETE FROM auth_sessions WHERE user_id = ?", [c.user.id]);
      await a.startSession(c.user.id);
    }
    if (data.data && typeof data.data === "object") {
      const allowed: Record<string, any> = {};
      for (const k of ["full_name", "avatar_url", "phone", "address", "org_type", "org_size", "role", "onboarded"]) if (k in data.data) allowed[k] = String(data.data[k] ?? "").slice(0, 500);
      let meta: Record<string, any> = {};
      try { meta = JSON.parse(row.user_metadata || "{}"); } catch { /* ignore */ }
      await d1("UPDATE auth_users SET user_metadata = ? WHERE id = ?", [JSON.stringify({ ...meta, ...allowed }), c.user.id]);
    }
    const fresh = (await d1("SELECT * FROM auth_users WHERE id = ?", [c.user.id]))[0];
    return { user: a.toPublicUser(fresh), error: null };
  });
