// Pure, runtime-agnostic helpers used by chat tools. No I/O; covered by tests.

// ---------- Math ----------
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: Math.log10, ln: Math.log, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** Safe arithmetic evaluator (no eval). Supports + - * / % ^, parentheses, functions and constants. */
export function evaluate(expr: string): number {
  const src = expr.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").toLowerCase();
  if (src.length > 500) throw new Error("Expression is too long.");
  let i = 0;
  const peek = () => src[i];
  const expect = (c: string) => { if (src[i] !== c) throw new Error(`Expected "${c}" at position ${i + 1}.`); i++; };
  function primary(): number {
    if (peek() === "(") { i++; const v = add(); expect(")"); return v; }
    if (peek() === "-") { i++; return -power(); }
    if (peek() === "+") { i++; return power(); }
    const num = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/);
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = src.slice(i).match(/^[a-z]+/);
    if (id) {
      i += id[0].length;
      if (id[0] in CONSTS) return CONSTS[id[0]];
      const f = FUNCS[id[0]];
      if (!f) throw new Error(`Unknown name "${id[0]}".`);
      expect("(");
      const args = [add()];
      while (peek() === ",") { i++; args.push(add()); }
      expect(")");
      return f(...args);
    }
    throw new Error(`Unexpected "${peek() ?? "end"}" at position ${i + 1}.`);
  }
  function postfix(): number { let v = primary(); while (peek() === "!") { i++; v = factorial(v); } return v; }
  function power(): number { const b = postfix(); if (peek() === "^") { i++; return Math.pow(b, power()); } return b; }
  function mul(): number {
    let v = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") { const op = src[i++]; const r = power(); v = op === "*" ? v * r : op === "/" ? v / r : v % r; }
    return v;
  }
  function add(): number {
    let v = mul();
    while (peek() === "+" || peek() === "-") { const op = src[i++]; const r = mul(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  const v = add();
  if (i < src.length) throw new Error(`Unexpected "${src[i]}" at position ${i + 1}.`);
  if (!Number.isFinite(v)) throw new Error("The result is not a finite number.");
  return v;
}
function factorial(n: number) { if (n < 0 || !Number.isInteger(n) || n > 170) throw new Error("Factorial needs a whole number 0–170."); let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; }

const UNITS: Record<string, [string, number]> = {
  mm: ["length", 0.001], cm: ["length", 0.01], m: ["length", 1], km: ["length", 1000], in: ["length", 0.0254], ft: ["length", 0.3048], yd: ["length", 0.9144], mi: ["length", 1609.344],
  mg: ["mass", 1e-6], g: ["mass", 0.001], kg: ["mass", 1], t: ["mass", 1000], oz: ["mass", 0.028349523125], lb: ["mass", 0.45359237],
  ml: ["volume", 0.001], l: ["volume", 1], gal: ["volume", 3.785411784], floz: ["volume", 0.0295735295625], cup: ["volume", 0.2365882365],
  s: ["time", 1], min: ["time", 60], h: ["time", 3600], day: ["time", 86400], week: ["time", 604800],
  b: ["data", 1], kb: ["data", 1000], mb: ["data", 1e6], gb: ["data", 1e9], tb: ["data", 1e12], kib: ["data", 1024], mib: ["data", 1048576], gib: ["data", 1073741824],
  "m/s": ["speed", 1], "km/h": ["speed", 1 / 3.6], mph: ["speed", 0.44704], kn: ["speed", 0.514444],
  m2: ["area", 1], km2: ["area", 1e6], ft2: ["area", 0.09290304], acre: ["area", 4046.8564224], ha: ["area", 10000],
};
export function convertUnit(value: number, from: string, to: string): number {
  const f = from.toLowerCase(), t = to.toLowerCase();
  const temps = ["c", "f", "k"];
  if (temps.includes(f) && temps.includes(t)) {
    const c = f === "c" ? value : f === "f" ? (value - 32) * 5 / 9 : value - 273.15;
    return t === "c" ? c : t === "f" ? c * 9 / 5 + 32 : c + 273.15;
  }
  const a = UNITS[f], b = UNITS[t];
  if (!a || !b) throw new Error(`Unknown unit "${!a ? from : to}". Supported: ${Object.keys(UNITS).join(", ")}, C, F, K.`);
  if (a[0] !== b[0]) throw new Error(`Can't convert ${a[0]} to ${b[0]}.`);
  return (value * a[1]) / b[1];
}

export function stats(nums: number[]) {
  const v = nums.filter((n) => Number.isFinite(n));
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const sum = v.reduce((a, b) => a + b, 0);
  const mean = sum / v.length;
  const mid = s.length >> 1;
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length;
  return { count: v.length, sum, mean, median, min: s[0], max: s[s.length - 1], stdDev: Math.sqrt(variance) };
}

// ---------- CSV ----------
export function parseCsv(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? guessDelimiter(text);
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
function guessDelimiter(text: string) {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return [",", ";", "\t", "|"].sort((a, b) => line.split(b).length - line.split(a).length)[0];
}
export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map((c) => { const s = c == null ? "" : typeof c === "object" ? JSON.stringify(c) : String(c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";
}
export function rowsToObjects(rows: string[][]) {
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h || `column${i + 1}`, autoType(r[i] ?? "")])));
}
export function objectsToRows(items: Record<string, unknown>[]): unknown[][] {
  const keys = [...new Set(items.flatMap((o) => Object.keys(o ?? {})))];
  return [keys, ...items.map((o) => keys.map((k) => (o as any)?.[k]))];
}
export const typedRows = (rows: string[][]): unknown[][] => rows.map((r, i) => (i ? r.map(autoType) : r));
export function autoType(s: string): unknown {
  const t = s.trim();
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t) && !(t.length > 1 && t.startsWith("0") && !t.startsWith("0."))) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  return s;
}

/** Column-by-column profile of a table (header row first). */
export function profileTable(rows: unknown[][]) {
  const [head, ...body] = rows;
  const columns = (head ?? []).map((h, ci) => {
    const vals = body.map((r) => r[ci]).filter((v) => v !== "" && v != null);
    const nums = vals.map((v) => (typeof v === "number" ? v : Number(String(v).replace(/,/g, "")))).filter((n) => Number.isFinite(n));
    const numeric = vals.length > 0 && nums.length / vals.length >= 0.8;
    const counts = new Map<string, number>();
    for (const v of vals) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    return {
      name: String(h ?? `Column ${ci + 1}`), type: numeric ? "number" : "text", filled: vals.length, empty: body.length - vals.length, unique: counts.size,
      ...(numeric ? { stats: stats(nums) } : { top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value, count })) }),
    };
  });
  const seen = new Set<string>(); let duplicates = 0;
  for (const r of body) { const k = JSON.stringify(r); if (seen.has(k)) duplicates++; else seen.add(k); }
  return { rows: body.length, columns, duplicateRows: duplicates };
}

// ---------- Text ----------
export function textStats(t: string) {
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  return { characters: t.length, charactersNoSpaces: t.replace(/\s/g, "").length, words, lines: t ? t.split(/\r?\n/).length : 0,
    sentences: (t.match(/[^.!?]+[.!?]+/g) ?? []).length, paragraphs: t.split(/\n\s*\n/).filter((p) => p.trim()).length, readingMinutes: Math.max(1, Math.round(words / 230)) };
}
export function changeCase(t: string, mode: string): string {
  const words = t.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_\-]+/).filter(Boolean);
  switch (mode) {
    case "upper": return t.toUpperCase();
    case "lower": return t.toLowerCase();
    case "title": return t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    case "sentence": return t.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase());
    case "camel": return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
    case "pascal": return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
    case "snake": return words.map((w) => w.toLowerCase()).join("_");
    case "kebab": case "slug": return slugify(t);
    case "constant": return words.map((w) => w.toUpperCase()).join("_");
    default: throw new Error(`Unknown case "${mode}".`);
  }
}
export const slugify = (t: string) => t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Line diff (LCS) returning unified-style lines. */
export function diffLines(a: string, b: string): { lines: string[]; added: number; removed: number } {
  const x = a.split(/\r?\n/), y = b.split(/\r?\n/);
  if (x.length * y.length > 4_000_000) throw new Error("Texts are too large to compare.");
  const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = []; let i = 0, j = 0, added = 0, removed = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { out.push(`  ${x[i]}`); i++; j++; }
    else if (j < y.length && (i >= x.length || dp[i][j + 1] >= dp[i + 1][j])) { out.push(`+ ${y[j++]}`); added++; }
    else { out.push(`- ${x[i++]}`); removed++; }
  }
  return { lines: out, added, removed };
}

const PII: [string, RegExp][] = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ["card", /\b(?:\d[ -]?){13,19}\b/g],
  ["phone", /(?:\+\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?){2,4}\d{3,4}\b/g],
  ["ip", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
];
export function redactPii(t: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let out = t;
  for (const [k, re] of PII) out = out.replace(re, (m) => { if (k === "phone" && m.replace(/\D/g, "").length < 7) return m; counts[k] = (counts[k] ?? 0) + 1; return `[${k.toUpperCase()} REDACTED]`; });
  return { text: out, counts };
}

export function generatePassword(length = 20, opts: { symbols?: boolean } = {}, rand: (n: number) => number = cryptoRand): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", ...(opts.symbols === false ? [] : ["!@#$%^&*-_=+?"])];
  const all = sets.join("");
  const len = Math.min(Math.max(length, 8), 128);
  const chars = sets.map((s) => s[rand(s.length)]);
  while (chars.length < len) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
function cryptoRand(n: number) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }

export function decodeJwt(token: string) {
  const parts = token.trim().split(".");
  if (parts.length < 2) throw new Error("Not a JWT (expected header.payload.signature).");
  const dec = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0))));
  const payload = dec(parts[1]);
  return { header: dec(parts[0]), payload, expired: typeof payload.exp === "number" ? payload.exp * 1000 < Date.now() : null, signatureVerified: false };
}

// ---------- Validation ----------
export function validateValue(kind: string, v: string): { valid: boolean; reason?: string } {
  const s = v.trim();
  switch (kind) {
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? { valid: true } : { valid: false, reason: "Not a valid email format" };
    case "url": try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? { valid: true } : { valid: false, reason: "Only http/https URLs" }; } catch { return { valid: false, reason: "Not a URL" }; }
    case "json": try { JSON.parse(s); return { valid: true }; } catch (e: any) { return { valid: false, reason: e.message }; }
    case "card": { const d = s.replace(/\D/g, ""); if (d.length < 12) return { valid: false, reason: "Too short" }; let sum = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 ? { valid: false, reason: "Luhn checksum failed" } : { valid: true }; }
    case "ipv4": return /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(s) ? { valid: true } : { valid: false, reason: "Not an IPv4 address" };
    case "uuid": return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? { valid: true } : { valid: false, reason: "Not a UUID" };
    default: throw new Error(`Unknown validation type "${kind}".`);
  }
}

// ---------- Charts (SVG) ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const PALETTE = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
export function chartSvg(type: "bar" | "line" | "pie", labels: string[], values: number[], title = ""): string {
  if (!labels.length || labels.length !== values.length) throw new Error("A chart needs matching labels and values.");
  if (values.some((v) => !Number.isFinite(v))) throw new Error("Chart values must be numbers.");
  const W = 720, H = 420, P = 56;
  let body = "";
  if (type === "pie") {
    const total = values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
    let a0 = -Math.PI / 2; const cx = 260, cy = 230, r = 150;
    values.forEach((v, i) => {
      const a1 = a0 + (Math.max(v, 0) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      body += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${PALETTE[i % 8]}"/>`;
      body += `<rect x="460" y="${90 + i * 24}" width="14" height="14" fill="${PALETTE[i % 8]}"/><text x="482" y="${102 + i * 24}" font-size="13">${esc(labels[i])} (${((Math.max(v, 0) / total) * 100).toFixed(1)}%)</text>`;
      a0 = a1;
    });
  } else {
    const max = Math.max(...values, 0), min = Math.min(...values, 0), span = max - min || 1;
    const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
    const step = (W - 2 * P) / labels.length;
    body += `<line x1="${P}" y1="${y(0)}" x2="${W - P}" y2="${y(0)}" stroke="#94a3b8"/>`;
    for (let k = 0; k <= 4; k++) { const v = min + (span * k) / 4; body += `<text x="${P - 8}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#64748b">${+v.toPrecision(4)}</text>`; }
    if (type === "bar") values.forEach((v, i) => { body += `<rect x="${P + i * step + step * 0.15}" y="${Math.min(y(v), y(0))}" width="${step * 0.7}" height="${Math.abs(y(v) - y(0))}" fill="${PALETTE[0]}" rx="3"/>`; });
    else body += `<polyline fill="none" stroke="${PALETTE[0]}" stroke-width="3" points="${values.map((v, i) => `${P + i * step + step / 2},${y(v)}`).join(" ")}"/>` + values.map((v, i) => `<circle cx="${P + i * step + step / 2}" cy="${y(v)}" r="4" fill="${PALETTE[0]}"/>`).join("");
    labels.forEach((l, i) => { body += `<text x="${P + i * step + step / 2}" y="${H - P + 18}" font-size="11" text-anchor="middle" fill="#334155">${esc(l.slice(0, 14))}</text>`; });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/><text x="${W / 2}" y="30" font-size="18" font-weight="bold" text-anchor="middle" fill="#0f172a">${esc(title)}</text>${body}</svg>`;
}

// ---------- Files ----------
export function sniffType(b: Uint8Array): { mime: string; ext: string } | null {
  const h = (n: number) => Array.from(b.subarray(0, n)).map((x) => x.toString(16).padStart(2, "0")).join("");
  const s = new TextDecoder().decode(b.subarray(0, 16));
  if (h(8) === "89504e470d0a1a0a") return { mime: "image/png", ext: "png" };
  if (h(3) === "ffd8ff") return { mime: "image/jpeg", ext: "jpg" };
  if (s.startsWith("GIF8")) return { mime: "image/gif", ext: "gif" };
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WAVE") return { mime: "audio/wav", ext: "wav" };
  if (s.startsWith("%PDF")) return { mime: "application/pdf", ext: "pdf" };
  if (h(4) === "504b0304") return { mime: "application/zip", ext: "zip" };
  if (s.startsWith("ID3") || h(2) === "fffb" || h(2) === "fff3") return { mime: "audio/mpeg", ext: "mp3" };
  if (s.slice(4, 8) === "ftyp") return { mime: "video/mp4", ext: "mp4" };
  if (s.startsWith("OggS")) return { mime: "audio/ogg", ext: "ogg" };
  if (h(4) === "1a45dfa3") return { mime: "video/webm", ext: "webm" };
  if (s.startsWith("BM")) return { mime: "image/bmp", ext: "bmp" };
  return null;
}

export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const t = sniffType(b)?.ext;
  if (t === "png" && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (t === "gif") return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (t === "bmp") return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
  if (t === "jpg") {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: dv.getUint16(o + 5), width: dv.getUint16(o + 7) };
      o += 2 + dv.getUint16(o + 2);
    }
  }
  if (t === "webp") {
    const kind = new TextDecoder().decode(b.subarray(12, 16));
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

export const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** Rejects URLs that would reach private networks (SSRF guard for the web fetch tool). */
export function isPublicHttpUrl(raw: string): boolean {
  let u: URL; try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.includes(":")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (h.includes(":") && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::")) return false;
  return true;
}

/** Plain text from HTML plus title, description, headings and links. */
export function htmlExtract(html: string, base?: string) {
  const pick = (re: RegExp) => html.match(re)?.[1]?.trim();
  const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) ?? pick(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)/i);
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `${"#".repeat(+m[1])} ${decode(m[2].replace(/<[^>]+>/g, "").trim())}`).filter((h) => h.length > 3).slice(0, 60);
  const links = [...new Set([...html.matchAll(/<a[^>]+href=["']([^"'#][^"']*)/gi)].map((m) => { try { return new URL(m[1], base).href; } catch { return m[1]; } }))].slice(0, 200);
  const text = decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { title: title ? decode(title) : undefined, description: description ? decode(description) : undefined, headings, links, text };
}
