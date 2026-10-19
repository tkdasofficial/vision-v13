// Google and GitHub sign-in (server-only) via the Vision auth gateway Worker.
// The Worker holds the provider credentials and runs the OAuth exchange; the app
// sends the browser there with a nonce (also kept in an HttpOnly cookie) and,
// on return to /auth/<provider>/callback, verifies the Worker's Ed25519-signed
// assertion: signature, issuer, audience (this origin), nonce, expiry, single use.
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { d1 } from "./d1.server";
import { createUser, randomToken, startSession } from "./auth.server";
import { oauthLinkMustResetPassword } from "../../../security";
import { providerCallbackUrl, type OAuthProvider } from "./oauth-urls";
import { AUTH_GATEWAY_URL, gatewayStartUrl, verifyGatewayAssertion } from "./auth-gateway";
import { getSecret } from "../ai/runtime-env.server";

export type Provider = OAuthProvider;
const STATE_COOKIE = "vision_oauth_state";

const gateway = () => (process.env["AUTH_GATEWAY_URL"] || AUTH_GATEWAY_URL).replace(/\/+$/, "");
// The public origin of this app. Set AUTH_ORIGIN (Worker var/secret) to host the frontend
// anywhere; without it the request's own origin is used. The origin must be listed in the
// auth gateway's ALLOWED_RETURN_ORIGINS.
const appOrigin = (req: Request) => (getSecret("AUTH_ORIGIN") || new URL(req.url).origin).replace(/\/+$/, "");

// Response.redirect() has immutable headers, which breaks the dev server's
// header merging ("TypeError: immutable") — build redirects manually instead.
const redirectTo = (url: string) =>
  new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const back = (req: Request, path: string) => redirectTo(new URL(path, req.url).toString());

const GATEWAY_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  provider_not_configured: "This sign-in option isn't set up yet.",
  email_unverified: "Your account needs a verified email address.",
  state_mismatch: "Sign-in expired. Please try again.",
};

export async function startOAuth(req: Request, p: Provider) {
  const nonce = randomToken(24);
  setCookie(STATE_COOKIE, `${p}:${nonce}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return redirectTo(gatewayStartUrl(gateway(), p, providerCallbackUrl(appOrigin(req), p), nonce));
}

export async function finishOAuth(req: Request, p: Provider) {
  const url = new URL(req.url);
  const saved = getCookie(STATE_COOKIE);
  deleteCookie(STATE_COOKIE, { path: "/" });
  const err = url.searchParams.get("error");
  if (err) return back(req, "/auth/login?error=" + encodeURIComponent(GATEWAY_ERRORS[err] ?? "Sign-in failed. Please try again."));
  const assertion = url.searchParams.get("assertion");
  const [savedP, nonce] = (saved ?? "").split(":");
  if (!assertion || savedP !== p || !nonce)
    return back(req, "/auth/login?error=" + encodeURIComponent("Sign-in was cancelled or expired. Please try again."));
  try {
    const claims = await verifyGatewayAssertion(assertion, { issuer: gateway(), audience: appOrigin(req), provider: p, nonce });
    // Single use: a replayed assertion is rejected.
    const used = await d1<{ jti: string }>(
      "INSERT INTO oauth_assertions_used (jti, expires_at) VALUES (?, ?) ON CONFLICT(jti) DO NOTHING RETURNING jti",
      [claims.jti, claims.exp],
    );
    if (!used.length) throw new Error("replay");
    await d1("DELETE FROM oauth_assertions_used WHERE expires_at < ?", [Math.floor(Date.now() / 1000) - 3600]);
    const prof = { id: claims.provider_user_id, email: claims.email.toLowerCase(), name: claims.name, avatar: claims.picture };
    let newAccount = false;
    let userId = (await d1<{ user_id: string }>("SELECT user_id FROM auth_identities WHERE provider = ? AND provider_user_id = ?", [p, prof.id]))[0]?.user_id;
    if (!userId) {
      // Link to an existing account with the same verified email, or create one.
      const existing = (await d1<{ id: string; email_verified: number; password_hash: string | null }>("SELECT id, email_verified, password_hash FROM auth_users WHERE email = ?", [prof.email]))[0];
      userId = existing?.id;
      // Pre-hijack defense: an unverified password account was never proven to belong to this email's owner,
      // so its password (possibly set by someone else) is discarded and its other sessions revoked.
      if (existing && oauthLinkMustResetPassword(existing)) {
        await d1("UPDATE auth_users SET password_hash = NULL, salt = NULL WHERE id = ?", [existing.id]);
        await d1("DELETE FROM auth_sessions WHERE user_id = ?", [existing.id]);
      }
      if (!userId) {
        // New account via OAuth: same signup abuse policy as the email form.
        const S = await import("./security.server");
        const { evaluateSignup, recordAccountCreated } = await import("../../../security");
        const facts = S.factsFrom(req.headers, S.ensureDeviceId());
        const keys = await S.keysFor(facts, prof.email);
        const verdict = await evaluateSignup(S.d1Store, { entry: "oauth", email: prof.email, req: facts, keys });
        if (!verdict.allowed) return back(req, "/auth/login?error=" + encodeURIComponent(verdict.userMessage ?? "Sign-up is temporarily unavailable."));
        userId = (await createUser(prof.email, { metadata: { full_name: prof.name, avatar_url: prof.avatar } })).id;
        await recordAccountCreated(S.d1Store, prof.email, keys);
        newAccount = true;
      }
      await d1("INSERT OR IGNORE INTO auth_identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)", [p, prof.id, userId]);
    }
    // Provider-verified email — no code needed.
    await d1("UPDATE auth_users SET email_verified = 1 WHERE id = ?", [userId]);
    const banned = (await d1<{ is_banned: number }>("SELECT is_banned FROM profiles WHERE id = ?", [userId]))[0]?.is_banned;
    if (banned) return back(req, "/auth/login?error=" + encodeURIComponent("This account has been suspended."));
    if (newAccount) {
      const S = await import("./security.server");
      await S.grantWelcomeCredits(userId!, prof.email, S.factsFrom(req.headers, S.ensureDeviceId()));
    }
    await startSession(userId!);
    return back(req, "/chat");
  } catch (e) {
    console.error("[oauth]", p, (e as Error).message);
    return back(req, "/auth/login?error=" + encodeURIComponent("Sign-in failed. Please try again."));
  }
}
