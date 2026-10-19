import { describe, expect, it } from "vitest";
import { gatewayStartUrl, verifyGatewayAssertion } from "@/lib/cloud/auth-gateway";
import { validateReturnTo } from "../../auth-gateway/src/index";

const env = { ALLOWED_RETURN_ORIGINS: "https://app.example.com, http://localhost:8080" };
const ISS = "https://gw.example.workers.dev";
const AUD = "https://app.example.com";

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const s = (o: object) => b64u(new TextEncoder().encode(JSON.stringify(o)));

async function keys() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { priv: kp.privateKey, jwk: await crypto.subtle.exportKey("jwk", kp.publicKey) };
}
async function sign(priv: CryptoKey, claims: object) {
  const h = s({ alg: "EdDSA", typ: "JWT" });
  const b = s(claims);
  return `${h}.${b}.${b64u(await crypto.subtle.sign({ name: "Ed25519" }, priv, new TextEncoder().encode(`${h}.${b}`)))}`;
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: ISS, aud: AUD, sub: "google:1", provider: "google", provider_user_id: "1", email: "a@b.com", email_verified: true, name: null, picture: null, nonce: "n".repeat(32), iat: now, exp: now + 120, jti: "j1" };
const opts = (jwk: JsonWebKey) => ({ issuer: ISS, audience: AUD, provider: "google" as const, nonce: "n".repeat(32), jwk });

describe("gateway return_to allowlist", () => {
  it("accepts exact allowlisted origins", () => {
    expect(validateReturnTo("https://app.example.com/google/callback", env)?.origin).toBe(AUD);
    expect(validateReturnTo("http://localhost:8080/github/callback", env)).not.toBeNull();
  });
  it("rejects lookalikes, other schemes, credentials and fragments", () => {
    for (const bad of [
      "https://app.example.com.evil.com/x", "https://evil.com/?https://app.example.com", "http://app.example.com/x",
      "https://user@app.example.com/x", "https://app.example.com/x#y", "javascript:alert(1)", "//app.example.com/x", "", null,
    ]) expect(validateReturnTo(bad as string | null, env)).toBeNull();
  });
  it("builds the start URL with encoded params", () => {
    const u = new URL(gatewayStartUrl(ISS + "/", "github", `${AUD}/github/callback`, "abc"));
    expect(u.pathname).toBe("/auth/github/start");
    expect(u.searchParams.get("return_to")).toBe(`${AUD}/github/callback`);
  });
});

describe("verifyGatewayAssertion", () => {
  it("accepts a valid assertion", async () => {
    const k = await keys();
    expect((await verifyGatewayAssertion(await sign(k.priv, good), opts(k.jwk))).email).toBe("a@b.com");
  });
  it("rejects wrong key, audience, nonce, provider, issuer and expiry", async () => {
    const k = await keys();
    const other = await keys();
    await expect(verifyGatewayAssertion(await sign(other.priv, good), opts(k.jwk))).rejects.toThrow("signature");
    for (const [patch, err] of [
      [{ aud: "https://evil.com" }, "audience"], [{ nonce: "x".repeat(32) }, "nonce"], [{ provider: "github" }, "provider"],
      [{ iss: "https://evil.workers.dev" }, "issuer"], [{ exp: now - 1 }, "expired"], [{ email_verified: false }, "claims"],
    ] as const) await expect(verifyGatewayAssertion(await sign(k.priv, { ...good, ...patch }), opts(k.jwk))).rejects.toThrow(err);
  });
  it("rejects a tampered payload", async () => {
    const k = await keys();
    const [h, , sig] = (await sign(k.priv, good)).split(".");
    await expect(verifyGatewayAssertion(`${h}.${s({ ...good, email: "x@evil.com" })}.${sig}`, opts(k.jwk))).rejects.toThrow("signature");
  });
});
