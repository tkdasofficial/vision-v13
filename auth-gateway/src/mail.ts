// Gmail SMTP sender running inside the Worker. Credentials come from the
// Cloudflare Secrets Store (SMTP_EMAIL / SMTP_PASSWORD) and never leave Cloudflare.
import { connect } from "cloudflare:sockets";

type StoreSecret = { get(): Promise<string> };
export interface MailEnv {
  SMTP_EMAIL: StoreSecret;
  SMTP_PASSWORD: StoreSecret;
  MAIL_TOKEN: string;
}

const enc = new TextEncoder();
const b64 = (s: string) => btoa(Array.from(enc.encode(s), (b) => String.fromCharCode(b)).join(""));
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function smtpSend(env: MailEnv, to: string, subject: string, text: string) {
  const from = (await env.SMTP_EMAIL.get()).trim();
  const password = (await env.SMTP_PASSWORD.get()).replace(/\s+/g, "");
  const socket = connect("smtp.gmail.com:465", { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const readReply = async () => {
    for (;;) {
      const m = buf.match(/^\d{3} [^\r\n]*\r?\n/m);
      if (m) { const out = buf.slice(0, m.index! + m[0].length); buf = buf.slice(m.index! + m[0].length); return out; }
      const { value, done } = await reader.read();
      if (done) throw new Error("connection closed");
      buf += dec.decode(value, { stream: true });
    }
  };
  const send = (l: string) => writer.write(enc.encode(l + "\r\n"));
  const expect = async (code: string, what: string) => {
    const r = await readReply();
    if (!r.startsWith(code)) throw new Error(`smtp ${what}: ${r.slice(0, 120)}`);
  };
  try {
    await expect("220", "greeting");
    await send("EHLO vision.app"); await expect("250", "ehlo");
    await send("AUTH LOGIN"); await expect("334", "auth");
    await send(b64(from)); await expect("334", "user");
    await send(b64(password)); await expect("235", "pass");
    await send(`MAIL FROM:<${from}>`); await expect("250", "from");
    await send(`RCPT TO:<${to}>`); await expect("250", "to");
    await send("DATA"); await expect("354", "data");
    const body = text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const msg = [
      `From: Vision <${from}>`, `To: ${to}`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body, ".",
    ].join("\r\n");
    await writer.write(enc.encode(msg + "\r\n")); await expect("250", "body");
    await send("QUIT");
  } finally {
    try { writer.releaseLock(); reader.releaseLock(); await socket.close(); } catch { /* ignore */ }
  }
}

/** POST /mail  { to, subject, text }  with Authorization: Bearer <MAIL_TOKEN> */
export async function handleMail(req: Request, env: MailEnv): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method !== "POST") return json(405, { error: "method" });
  const auth = req.headers.get("Authorization") ?? "";
  if (!env.MAIL_TOKEN || !safeEqual(auth, `Bearer ${env.MAIL_TOKEN}`)) return json(401, { error: "unauthorized" });
  let data: any;
  try { data = await req.json(); } catch { return json(400, { error: "body" }); }
  const to = clean(String(data?.to ?? ""));
  const subject = clean(String(data?.subject ?? "")).slice(0, 200);
  const text = String(data?.text ?? "").slice(0, 20000);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to) || to.length > 254 || !subject || !text) return json(400, { error: "invalid" });
  try {
    await smtpSend(env, to, subject, text);
    return json(200, { ok: true });
  } catch (e) {
    console.error("[mail]", (e as Error).message);
    return json(502, { error: "send_failed" });
  }
}
