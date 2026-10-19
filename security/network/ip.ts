// Client IP handling. Only Cloudflare's CF-Connecting-IP is trusted; X-Forwarded-For is never used.

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function isValidIp(ip: string): boolean {
  return IPV4.test(ip) || (ip.includes(":") && IPV6.test(ip) && ip.length <= 45);
}

export function extractClientIp(headers: Headers): string | null {
  const v = headers.get("cf-connecting-ip")?.trim();
  return v && isValidIp(v) ? v.toLowerCase() : null;
}

/** Network bucket: /24 for IPv4, /64 for IPv6. Groups CGNAT/shared users rather than singling them out. */
export function networkPrefix(ip: string): string {
  if (IPV4.test(ip)) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  const parts = ip.split("::")[0]!.split(":");
  while (parts.length < 4) parts.push("0");
  return parts.slice(0, 4).join(":") + "::/64";
}
