// Browser-safe OAuth URL helpers. Every provider callback derives from one
// base origin, so a domain change only needs one update (AUTH_ORIGIN).
export type OAuthProvider = "google" | "github";

export const providerCallbackUrl = (base: string, p: OAuthProvider) =>
  `${base.replace(/\/+$/, "")}/auth/${p}/callback`;
