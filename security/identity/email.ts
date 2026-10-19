// Email syntax validation and normalization.

const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Small set of well-known throwaway domains; used only as a risk signal, never as the sole reason to reject. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
]);

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254 || !EMAIL.test(email)) return false;
  const [local] = email.split("@");
  return !!local && local.length <= 64 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** Correlation key that folds plus-tags and Gmail dots. Used for abuse counting only, never as the login identity. */
export function canonicalEmail(email: string): string {
  const domain = emailDomain(email);
  let local = email.slice(0, email.lastIndexOf("@")).split("+")[0]!;
  const d = domain === "googlemail.com" ? "gmail.com" : domain;
  if (d === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${d}`;
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE.has(domain);
}

/** When OAuth links to an existing account: an unverified password must not survive (account pre-hijacking). */
export function oauthLinkMustResetPassword(row: { email_verified: number | boolean | null; password_hash: string | null }): boolean {
  return !row.email_verified && !!row.password_hash;
}
