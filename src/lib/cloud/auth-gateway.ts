// Client for the Vision auth gateway (Cloudflare Worker `vision-auth`).
// Provider credentials live only in the Worker; the app only holds the
// gateway's PUBLIC key and verifies the signed assertion it returns.
import type { OAuthProvider } from "./oauth-urls";

export const AUTH_GATEWAY_URL = "https://vision.tusharkantidasofficial.workers.dev";
export const AUTH_GATEWAY_PUBLIC_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  x: "7COTPYRjMyIwCwXedj9GbAleU1xW6CvuG7QqtT-MH-U",
  kid: "vision-auth-2",
} as const;

export const gatewayStartUrl = (gateway: string, p: OAuthProvider, returnTo: string, nonce: string) => {
  const u = new URL(`${gateway.replace(/\/+$/, "")}/auth/${p}/start`);
  u.searchParams.set("return_to", returnTo);
  u.searchParams.set("nonce", nonce);
  return u.toString();
};

export type GatewayClaims = {
  iss: string; aud: string; sub: string; provider: OAuthProvider; provider_user_id: string;
  email: string; email_verified: boolean; name: string | null; picture: string | null;
  nonce: string; iat: number; exp: number; jti: string;
};

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Verifies signature, issuer, audience, provider, nonce and lifetime. Throws on any mismatch. */
export async function verifyGatewayAssertion(
  token: string,
  opts: { issuer: string; audience: string; provider: OAuthProvider; nonce: string; jwk?: JsonWebKey; now?: number },
): Promise<GatewayClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 4096) throw new Error("malformed");
  const [h, b, s] = parts;
  const head = JSON.parse(new TextDecoder().decode(fromB64u(h)));
  if (head.alg !== "EdDSA") throw new Error("alg");
  const key = await crypto.subtle.importKey("jwk", (opts.jwk ?? AUTH_GATEWAY_PUBLIC_JWK) as JsonWebKey, { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64u(s), new TextEncoder().encode(`${h}.${b}`));
  if (!ok) throw new Error("signature");
  const c = JSON.parse(new TextDecoder().decode(fromB64u(b))) as GatewayClaims;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (c.iss !== opts.issuer.replace(/\/+$/, "")) throw new Error("issuer");
  if (c.aud !== opts.audience) throw new Error("audience");
  if (c.provider !== opts.provider) throw new Error("provider");
  if (!opts.nonce || c.nonce !== opts.nonce) throw new Error("nonce");
  if (typeof c.exp !== "number" || c.exp < now || c.iat > now + 60 || c.exp - c.iat > 300) throw new Error("expired");
  if (!c.email_verified || !c.email || !c.provider_user_id || !c.jti) throw new Error("claims");
  return c;
}
