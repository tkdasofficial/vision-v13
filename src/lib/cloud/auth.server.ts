// Server-only account, password and session handling backed by D1.
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { d1 } from "./d1.server";
import { SECURITY_CONFIG, SESSION_COOKIE_OPTIONS, nowSec, RateLimitError } from "../../../security";

export const SESSION_COOKIE = "vision_session";
const SESSION_DAYS = SECURITY_CONFIG.session.days;
const MAX_SESSIONS = SECURITY_CONFIG.session.maxConcurrent;
const PBKDF2_ITERATIONS = 100_000;

export type PublicUser = {
  id: string;
  email: string;
  created_at: string;
  user_metadata: Record<string, any>;
  app_metadata: Record<string, any>;
};

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

export async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return hex(bits);
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  return safeEqual(await hashPassword(password, salt), expected);
}

export function toPublicUser(row: any, provider = "email"): PublicUser {
  let meta: Record<string, any> = {};
  try { meta = JSON.parse(row.user_metadata || "{}"); } catch { /* ignore */ }
  return { id: row.id, email: row.email, created_at: row.created_at, user_metadata: meta, app_metadata: { provider } };
}

/** Limits repeated attempts per key using the shared atomic security counter. */
export async function rateLimit(key: string, max: number, windowSec: number) {
  const { d1Store } = await import("./security.server");
  if ((await d1Store.hit(`rl:${key}`, windowSec, nowSec())) > max) throw new RateLimitError();
}

export async function createUser(email: string, opts: { password?: string; metadata?: Record<string, any> }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let salt: string | null = null;
  let hash: string | null = null;
  if (opts.password) { salt = randomToken(16); hash = await hashPassword(opts.password, salt); }
  const meta = opts.metadata ?? {};
  await d1("INSERT INTO auth_users (id, email, password_hash, salt, user_metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, email, hash, salt, JSON.stringify(meta), now]);
  await d1("INSERT INTO profiles (id, email, full_name, avatar_url, is_banned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)", [id, email, meta.full_name ?? null, meta.avatar_url ?? null, now, now]);
  const count = await d1<{ n: number }>("SELECT COUNT(*) AS n FROM auth_users");
  // The very first account becomes the admin.
  if ((count[0]?.n ?? 0) === 1) await d1("INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)", [crypto.randomUUID(), id, now]);
  await d1("INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, 'user', ?)", [crypto.randomUUID(), id, now]);
  return (await d1("SELECT * FROM auth_users WHERE id = ?", [id]))[0];
}

// Lightweight header read (avoids importing the security module eagerly).
async function clientInfo(): Promise<{ ua: string; ip: string | null }> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const h = getRequest().headers;
    const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    return { ua: (h.get("user-agent") ?? "").slice(0, 300), ip };
  } catch { return { ua: "", ip: null }; }
}

/** Issues a fresh session (rotating any current one), prunes expired ones, caps concurrent sessions, and records login history. */
export async function startSession(userId: string) {
  const prev = getCookie(SESSION_COOKIE);
  if (prev) await d1("DELETE FROM auth_sessions WHERE token_hash = ?", [await sha256(prev)]);
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  const expires = now + SESSION_DAYS * 86400;
  const { ua, ip } = await clientInfo();
  await d1(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [await sha256(token), userId, expires, now, now, ua, ip],
  );
  await d1("INSERT INTO login_history (id, user_id, created_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)", [crypto.randomUUID(), userId, now, ua, ip]);
  await d1("DELETE FROM login_history WHERE user_id = ? AND created_at < ?", [userId, now - 180 * 86400]);
  await d1("DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= ?", [userId, now]);
  await d1(
    "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id = ? ORDER BY expires_at DESC, rowid DESC LIMIT ?)",
    [userId, userId, MAX_SESSIONS],
  );
  setCookie(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_DAYS * 86400 });
}

export async function endSession() {
  const token = getCookie(SESSION_COOKIE);
  if (token) await d1("DELETE FROM auth_sessions WHERE token_hash = ?", [await sha256(token)]);
  deleteCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
  deleteCookie(SESSION_COOKIE, { path: "/" }); // legacy non-partitioned cookie
}

export type Caller = { user: PublicUser; isAdmin: boolean };

/** Returns the signed-in caller from the secure session cookie, or null. Active sessions slide forward so users stay signed in. */
export async function getCaller(): Promise<Caller | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const hash = await sha256(token);
  const rows = await d1(
    `SELECT u.*, p.is_banned AS is_banned, s.expires_at AS s_expires, s.last_seen_at AS s_seen,
       EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin') AS is_admin
     FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
     LEFT JOIN profiles p ON p.id = u.id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [hash, now],
  );
  const row: any = rows[0];
  if (!row || row.is_banned) return null;
  // Renew at most once a day: extend expiry and refresh the cookie.
  if (!row.s_seen || now - row.s_seen > 86400) {
    try {
      await d1("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?", [now, now + SESSION_DAYS * 86400, hash]);
      setCookie(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_DAYS * 86400 });
    } catch { /* renewal is best-effort */ }
  }
  return { user: toPublicUser(row), isAdmin: !!row.is_admin };
}

export async function requireCaller(): Promise<Caller> {
  const c = await getCaller();
  if (!c) throw new Error("Please sign in to continue.");
  return c;
}
