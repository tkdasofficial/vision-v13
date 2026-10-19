// Server-only 8-digit email verification codes, stored as keyed hashes in D1.
import { d1 } from "./d1.server";
import { randomToken } from "./auth.server";
import { sendMail } from "./mail.server";
import { randomDigits, safeEqual, SECURITY_CONFIG } from "../../../security";
import { pseudonym } from "./security.server";

const OTP_TTL_SEC = SECURITY_CONFIG.otp.ttlSec;
const MAX_ATTEMPTS = SECURITY_CONFIG.otp.maxAttempts;

export function generateOtp(): string {
  return randomDigits(8);
}

const codeHash = (email: string, code: string) => pseudonym("otp", `${email}:${code}`);

/** Creates and emails a fresh 8-digit code for the address (replaces any previous code). */
export type OtpPurpose = "verify" | "reset" | `enterprise:${string}`;
// Each purpose gets its own row, so a sign-up code can never reset a password (and vice versa).
const slot = (email: string, purpose: OtpPurpose) => (purpose === "verify" ? email : `${purpose}:${email}`);

export async function sendOtp(email: string, purpose: OtpPurpose = "verify") {
  const code = generateOtp();
  const key = slot(email, purpose);
  const hash = await codeHash(key, code);
  const now = new Date().toISOString();
  const expires = Math.floor(Date.now() / 1000) + OTP_TTL_SEC;
  await d1(
    "INSERT INTO auth_otps (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at",
    [key, hash, expires, now],
  );
  const reset = purpose === "reset";
  const ent = purpose.startsWith("enterprise:");
  await sendMail(
    email,
    reset ? "Reset your Vision password" : ent ? "Your Vision Enterprise Login code" : "Your Vision verification code",
    `Hi,\n\nYour Vision ${reset ? "password reset" : ent ? "Enterprise Login" : "verification"} code is:\n\n${code}\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.\n\n— Vision`,
  );
}

/** Checks a code. Attempts are counted atomically and a valid code is consumed exactly once. */
export async function checkOtp(email: string, code: string, purpose: OtpPurpose = "verify"): Promise<boolean> {
  email = slot(email, purpose);
  const now = Math.floor(Date.now() / 1000);
  const row = (await d1<{ code_hash: string; attempts: number }>(
    "UPDATE auth_otps SET attempts = attempts + 1 WHERE email = ? AND expires_at >= ? AND attempts < ? RETURNING code_hash, attempts",
    [email, now, MAX_ATTEMPTS],
  ))[0];
  if (!row) return false;
  if (!safeEqual(row.code_hash, await codeHash(email, code))) return false;
  // Single use: only one concurrent request can delete the row.
  const consumed = await d1("DELETE FROM auth_otps WHERE email = ? AND code_hash = ? RETURNING email", [email, row.code_hash]);
  return consumed.length > 0;
}

export { randomToken };
