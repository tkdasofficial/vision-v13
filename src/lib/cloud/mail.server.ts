// Server-only email sending. Delivery runs on the Cloudflare gateway Worker
// (POST /mail), which holds the Gmail SMTP credentials in the Cloudflare
// Secrets Store. The app only holds MAIL_TOKEN to authorize the call.
import { AUTH_GATEWAY_URL } from "./auth-gateway";

export async function sendMail(to: string, subject: string, text: string) {
  const token = process.env["MAIL_TOKEN"];
  if (!token) throw new Error("Email is not configured");
  const res = await fetch(`${AUTH_GATEWAY_URL}/mail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, text }),
  });
  if (!res.ok) {
    console.error("[mail] gateway send failed", res.status, await res.text().catch(() => ""));
    throw new Error("Could not send the email");
  }
}
