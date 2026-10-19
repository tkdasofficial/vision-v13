// Enterprise domain checks. Ownership is proven ONLY by a server-checked DNS TXT challenge;
// website/DNS signals are informational. Network access goes through DoH and a guarded HTTPS probe.

export type Fetcher = typeof fetch;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Accepts "Example.com", "https://www.example.com/path" etc. and returns "example.com" (or null if invalid). */
export function normalizeDomain(raw: unknown): string | null {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s || s.length > 253 + 12) return null;
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0]!.split("@").pop()!.replace(/:\d+$/, "").replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (s.length > 253 || /^\d+(\.\d+){3}$/.test(s) || s.includes(":")) return null; // no raw IPs
  const labels = s.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels.at(-1)!)) return null;
  if (["localhost", "local", "internal", "test", "example", "invalid", "onion", "lan", "home", "corp"].includes(labels.at(-1)!)) return null;
  return s;
}

export function normalizeEnterpriseName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 120 || /[<>{}\u0000-\u001f]/.test(s)) return null;
  return s;
}

/** True when the email's domain is the enterprise domain or one of its subdomains. */
export function emailMatchesDomain(email: string, domain: string): boolean {
  const d = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return d === domain || d.endsWith("." + domain);
}

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges (SSRF / rebinding guard). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("ff") || x.startsWith("::ffff:");
}

type DohAnswer = { type: number; data: string };
async function doh(name: string, type: string, f: Fetcher, timeoutMs = 2500): Promise<{ status: number; answers: DohAnswer[] } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: ctl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { Status: number; Answer?: DohAnswer[] };
    return { status: j.Status, answers: j.Answer ?? [] };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type DomainReport = {
  resolves: boolean;
  publicAddresses: boolean;
  hasMx: boolean;
  https: "ok" | "unavailable" | "skipped";
  siteTitle: string | null;
  nameMatch: "match" | "mismatch" | "unknown";
};

/** Words of the enterprise name that look meaningful (drops "inc", "ltd", ...). */
function nameTokens(name: string) {
  const stop = new Set(["inc", "ltd", "llc", "limited", "corp", "corporation", "co", "company", "the", "pvt", "private", "plc", "gmbh", "group", "and", "of"]);
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !stop.has(w));
}

export function compareNameToSite(name: string, domain: string, title: string | null): DomainReport["nameMatch"] {
  const tokens = nameTokens(name);
  if (!tokens.length) return "unknown";
  const hay = `${domain.replace(/\./g, " ")} ${(title ?? "").toLowerCase()}`.replace(/[^a-z0-9 ]/g, " ");
  const compactHay = hay.replace(/\s+/g, "");
  if (tokens.some((t) => hay.includes(t)) || compactHay.includes(tokens.join(""))) return "match";
  return title ? "mismatch" : "unknown";
}

/** Guarded HTTPS probe: https only, public resolved addresses only, manual redirects (max 3) re-validated each hop. */
async function probeHttps(domain: string, f: Fetcher): Promise<{ ok: boolean; title: string | null }> {
  let url = `https://${domain}/`;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || (u.port && u.port !== "443")) return { ok: false, title: null };
    if (!normalizeDomain(u.hostname)) return { ok: false, title: null };
    const a = await doh(u.hostname, "A", f);
    const ips = (a?.answers ?? []).filter((x) => x.type === 1 || x.type === 28).map((x) => x.data);
    if (!ips.length || ips.some(isPrivateAddress)) return { ok: false, title: null };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await f(url, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "VisionDomainCheck/1.0", accept: "text/html" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, title: null };
        url = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) return { ok: true, title: null };
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        while (html.length < 64_000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += new TextDecoder().decode(value);
        }
        reader.cancel().catch(() => {});
      }
      const m = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html) ?? /property=["']og:site_name["'][^>]*content=["']([^"']{1,200})/i.exec(html);
      return { ok: true, title: m ? m[1]!.trim() : null };
    } catch {
      return { ok: false, title: null };
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, title: null };
}

export async function inspectDomain(domain: string, name: string, f: Fetcher = fetch): Promise<DomainReport> {
  const [a, aaaa, mx] = await Promise.all([doh(domain, "A", f), doh(domain, "AAAA", f), doh(domain, "MX", f)]);
  const ips = [...(a?.answers ?? []), ...(aaaa?.answers ?? [])].filter((x) => x.type === 1 || x.type === 28).map((x) => x.data);
  const hasMx = !!mx?.answers.some((x) => x.type === 15);
  const resolves = ips.length > 0 || hasMx;
  const publicAddresses = ips.length > 0 && !ips.some(isPrivateAddress);
  let https: DomainReport["https"] = "skipped";
  let siteTitle: string | null = null;
  if (publicAddresses) {
    const p = await probeHttps(domain, f);
    https = p.ok ? "ok" : "unavailable";
    siteTitle = p.title;
  }
  return { resolves, publicAddresses, hasMx, https, siteTitle, nameMatch: compareNameToSite(name, domain, siteTitle) };
}

export const TXT_PREFIX = "_vision-verify";
export const txtRecordName = (domain: string) => `${TXT_PREFIX}.${domain}`;

/** Checks the TXT challenge directly via DNS. Returns "verified", "missing" or "unknown" (DNS failure). */
export async function checkTxtChallenge(domain: string, expected: string, f: Fetcher = fetch): Promise<"verified" | "missing" | "unknown"> {
  const r = await doh(txtRecordName(domain), "TXT", f);
  if (!r) return "unknown";
  const values = r.answers.filter((x) => x.type === 16).map((x) => x.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "").trim());
  return values.includes(expected) ? "verified" : "missing";
}
