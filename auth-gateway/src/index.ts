import { handleMail, type MailEnv } from "./mail";
import { handleAi, type AiEnv } from "./ai";
import { handleRuntime, type RuntimeEnv } from "./runtime";
// Vision auth gateway (Cloudflare Worker).
// Runs Google/GitHub OAuth with provider credentials that live only here, then
// hands the app a short-lived Ed25519-signed assertion bound to the browser's nonce.
//
//   GET /auth/:provider/start?return_to=<allowlisted URL>&nonce=<app nonce>
//   GET /auth/:provider/callback        (registered in Google/GitHub dashboards)
//   GET /.well-known/jwks.json           (public verification key)
//   GET /health

export interface Env {
  ALLOWED_RETURN_ORIGINS: string; // comma-separated exact origins
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  STATE_KEY: string; // HMAC key for the state cookie
  SIGNING_KEY: string; // Ed25519 private key, JWK JSON
}

type Provider = "google" | "github";
const PROVIDERS: Provider[] = ["google", "github"];
const STATE_COOKIE = "__Host-vag_state";
const STATE_TTL = 600;
const ASSERTION_TTL = 120;

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uStr = (s: string) => b64u(enc.encode(s));
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rand = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));

const SEC_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};
const redirect = (url: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 302, headers: { ...SEC_HEADERS, Location: url, ...extra } });
const text = (status: number, body: string) =>
  new Response(body, { status, headers: { ...SEC_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export function allowedOrigins(env: Pick<Env, "ALLOWED_RETURN_ORIGINS">): Set<string> {
  return new Set(
    (env.ALLOWED_RETURN_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
  );
}

/** Exact-origin allowlist; https only (http allowed for localhost). Returns the normalized URL or null. */
export function validateReturnTo(raw: string | null, env: Pick<Env, "ALLOWED_RETURN_ORIGINS">): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.username || u.password || u.hash) return null;
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  if (!allowedOrigins(env).has(u.origin)) return null;
  return u;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sealState(env: Env, data: object) {
  const body = b64uStr(JSON.stringify(data));
  const sig = b64u(await crypto.subtle.sign("HMAC", await hmacKey(env.STATE_KEY), enc.encode(body)));
  return `${body}.${sig}`;
}
async function openState(env: Env, token: string | undefined): Promise<any | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.STATE_KEY), fromB64u(sig), enc.encode(body));
  if (!ok) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    return d.exp > Date.now() / 1000 ? d : null;
  } catch { return null; }
}
function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
const stateCookie = (value: string, maxAge: number) =>
  `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/** Constant-time string compare. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

let signingKey: { key: CryptoKey; pub: JsonWebKey; kid: string } | null = null;
async function getSigningKey(env: Env) {
  if (signingKey) return signingKey;
  const jwk = JSON.parse(env.SIGNING_KEY) as JsonWebKey & { kid?: string };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x } as JsonWebKey;
  signingKey = { key, pub, kid: jwk.kid || "vision-auth-1" };
  return signingKey;
}
async function signAssertion(env: Env, claims: Record<string, unknown>) {
  const k = await getSigningKey(env);
  const head = b64uStr(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: k.kid }));
  const body = b64uStr(JSON.stringify(claims));
  const sig = b64u(await crypto.subtle.sign({ name: "Ed25519" }, k.key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${sig}`;
}

const creds = (env: Env, p: Provider) =>
  p === "google"
    ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
    : { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET };
const callbackUrl = (req: Request, p: Provider) => `${new URL(req.url).origin}/auth/${p}/callback`;

async function start(req: Request, env: Env, p: Provider) {
  const url = new URL(req.url);
  const returnTo = validateReturnTo(url.searchParams.get("return_to"), env);
  if (!returnTo) return text(400, "Return address is not allowed.");
  const nonce = url.searchParams.get("nonce") || "";
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) return text(400, "Invalid request.");
  const c = creds(env, p);
  if (!c.id || !c.secret) return redirect(withParams(returnTo, { error: "provider_not_configured" }));

  const state = rand();
  const verifier = rand(48);
  const challenge = b64u(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  const sealed = await sealState(env, {
    p, state, verifier, nonce, return_to: returnTo.toString(), exp: Math.floor(Date.now() / 1000) + STATE_TTL,
  });

  const auth = p === "google"
    ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
    : new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", c.id);
  auth.searchParams.set("redirect_uri", callbackUrl(req, p));
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  if (p === "google") {
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "openid email profile");
    auth.searchParams.set("prompt", "select_account");
  } else {
    auth.searchParams.set("scope", "read:user user:email");
    auth.searchParams.set("allow_signup", "true");
  }
  return redirect(auth.toString(), { "Set-Cookie": stateCookie(sealed, STATE_TTL) });
}

function withParams(u: URL, params: Record<string, string>) {
  const out = new URL(u.toString());
  for (const [k, v] of Object.entries(params)) out.searchParams.set(k, v);
  return out.toString();
}

async function fetchJson(url: string, init: RequestInit, what: string) {
  const res = await fetch(url, init);
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`${what} ${res.status}`);
  return body;
}

async function profile(req: Request, env: Env, p: Provider, code: string, verifier: string) {
  const c = creds(env, p);
  if (p === "google") {
    const t = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: c.id, client_secret: c.secret, redirect_uri: callbackUrl(req, p),
        grant_type: "authorization_code", code_verifier: verifier,
      }),
    }, "google_token");
    if (!t.access_token) throw new Error("google_token");
    const u = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    }, "google_userinfo");
    if (!u.sub || !u.email || u.email_verified !== true) throw new Error("email_unverified");
    return { id: String(u.sub), email: String(u.email).toLowerCase(), name: u.name ?? null, avatar: u.picture ?? null };
  }
  const t = await fetchJson("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: c.id, client_secret: c.secret, code, redirect_uri: callbackUrl(req, p), code_verifier: verifier }),
  }, "github_token");
  if (!t.access_token) throw new Error("github_token");
  const h = { Authorization: `Bearer ${t.access_token}`, "User-Agent": "Vision-Auth", Accept: "application/vnd.github+json" };
  const u = await fetchJson("https://api.github.com/user", { headers: h }, "github_user");
  const emails = await fetchJson("https://api.github.com/user/emails", { headers: h }, "github_emails");
  const primary = Array.isArray(emails) ? emails.find((e: any) => e.primary && e.verified) : null;
  if (!u.id || !primary?.email) throw new Error("email_unverified");
  return { id: String(u.id), email: String(primary.email).toLowerCase(), name: u.name ?? u.login ?? null, avatar: u.avatar_url ?? null };
}

async function callback(req: Request, env: Env, p: Provider) {
  const url = new URL(req.url);
  const st = await openState(env, readCookie(req, STATE_COOKIE));
  const clear = { "Set-Cookie": stateCookie("", 0) };
  if (!st || st.p !== p) return text(400, "Sign-in expired. Please go back and try again.");
  // Re-validate in case the allowlist changed since start.
  const returnTo = validateReturnTo(st.return_to, env);
  if (!returnTo) return text(400, "Return address is not allowed.");
  const fail = (error: string) => redirect(withParams(returnTo, { error }), clear);
  if (url.searchParams.get("error")) return fail("access_denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (!code || !safeEqual(state, st.state)) return fail("state_mismatch");
  try {
    const prof = await profile(req, env, p, code, st.verifier);
    const now = Math.floor(Date.now() / 1000);
    const assertion = await signAssertion(env, {
      iss: url.origin,
      aud: returnTo.origin,
      sub: `${p}:${prof.id}`,
      provider: p,
      provider_user_id: prof.id,
      email: prof.email,
      email_verified: true,
      name: prof.name,
      picture: prof.avatar,
      nonce: st.nonce,
      iat: now,
      exp: now + ASSERTION_TTL,
      jti: rand(16),
    });
    return redirect(withParams(returnTo, { assertion }), clear);
  } catch (e) {
    console.error("[auth-gateway]", p, (e as Error).message);
    return fail((e as Error).message === "email_unverified" ? "email_unverified" : "provider_error");
  }
}

export default {
  async fetch(req: Request, env: Env & MailEnv & RuntimeEnv & AiEnv): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/mail") return handleMail(req, env);
    const ai = url.pathname.match(/^\/ai\/(nvidia|groq|cf|run)$/);
    if (ai) return handleAi(req, env, ai[1]);
    if (url.pathname.startsWith("/runtime/")) return handleRuntime(req, env, url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Method not allowed");
    if (url.pathname === "/health") return text(200, "ok");
    if (url.pathname === "/.well-known/jwks.json") {
      const k = await getSigningKey(env);
      return new Response(JSON.stringify({ keys: [{ ...k.pub, alg: "EdDSA", use: "sig", kid: k.kid }] }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }
    const m = url.pathname.match(/^\/auth\/(google|github)\/(start|callback)$/);
    if (!m || !PROVIDERS.includes(m[1] as Provider)) return text(404, "Not found");
    const p = m[1] as Provider;
    return m[2] === "start" ? start(req, env, p) : callback(req, env, p);
  },
};
