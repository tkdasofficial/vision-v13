// MX lookup via DNS-over-HTTPS (works on Workers). Failures resolve to "unknown", never to a rejection.
import type { DnsStatus } from "../types";
import { SECURITY_CONFIG } from "../config";

type Fetcher = typeof fetch;
const cache = new Map<string, { status: DnsStatus; at: number }>();

async function query(name: string, type: "MX" | "A", f: Fetcher, timeoutMs: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await f(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" }, signal: ctl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as { Status: number; Answer?: { type: number }[] };
  } finally {
    clearTimeout(t);
  }
}

export async function checkMailDomain(domain: string, f: Fetcher = fetch, now = Date.now()): Promise<DnsStatus> {
  const hit = cache.get(domain);
  if (hit && now - hit.at < SECURITY_CONFIG.dns.cacheTtlMs) return hit.status;
  let status: DnsStatus = "unknown";
  try {
    const mx = await query(domain, "MX", f, SECURITY_CONFIG.dns.timeoutMs);
    if (!mx) status = "unknown";
    else if (mx.Status === 3) status = "nxdomain";
    else if (mx.Status !== 0) status = "unknown";
    else if (mx.Answer?.some((a) => a.type === 15)) status = "mx";
    else {
      const a = await query(domain, "A", f, SECURITY_CONFIG.dns.timeoutMs);
      status = !a || a.Status !== 0 ? "unknown" : a.Answer?.some((x) => x.type === 1) ? "no_mx_has_a" : "no_mail";
    }
  } catch {
    status = "unknown";
  }
  if (status !== "unknown") cache.set(domain, { status, at: now });
  return status;
}

export function clearDnsCache() { cache.clear(); }
