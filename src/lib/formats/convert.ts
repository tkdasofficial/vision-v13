// Inline (Cloudflare Worker) readers/writers for the formats whose conversions are pure JS.
// Every reader parses real structure into an intermediate form; writers serialise it; nothing is renamed.
import { strFromU8, strToU8, unzipSync, zipSync, gunzipSync, gzipSync, unzlibSync, inflateSync } from "fflate";
import YAML from "yaml";
import * as TOML from "smol-toml";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { parseCsv, toCsv, autoType, objectsToRows } from "@/lib/tools/pure";
import { readXlsx, writeXlsx } from "@/lib/tools/office";

export class FormatError extends Error {}
const fail = (m: string): never => { throw new FormatError(m); };

export const LIMITS = { maxUnpacked: 100 * 1024 * 1024, maxEntries: 5000, maxRows: 200_000 };

export type Rows = unknown[][];
export type Cue = { start: number; end: number; text: string };
export type Feature = { type: "Feature"; geometry: { type: "Point" | "LineString" | "Polygon"; coordinates: any }; properties: Record<string, unknown> };
export type Inter =
  | { kind: "table"; rows: Rows }
  | { kind: "tree"; value: unknown }
  | { kind: "doc"; title: string; md: string }
  | { kind: "cues"; cues: Cue[] }
  | { kind: "geo"; features: Feature[] }
  | { kind: "files"; files: { path: string; bytes: Uint8Array }[] };

const dec = (b: Uint8Array) => { const s = new TextDecoder("utf-8", { fatal: false }).decode(b); return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; };
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xml = () => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", processEntities: true, htmlEntities: false, allowBooleanAttributes: true, parseTagValue: false, trimValues: true });

/** Rejects DOCTYPE/ENTITY declarations so no entity expansion can happen. */
function safeXml(s: string) { if (/<!DOCTYPE[\s\S]*?<!ENTITY/i.test(s) || /<!ENTITY/i.test(s)) fail("XML with entity declarations is refused for safety."); return xml().parse(s); }

// ---------- tables ----------
export function treeToRows(v: unknown): Rows {
  let list: unknown = v;
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const arr = Object.values(list as object).find((x) => Array.isArray(x));
    list = arr ?? [list];
  }
  if (!Array.isArray(list)) fail("This data is not a list of records, so it can't become a table.");
  const items = (list as unknown[]).map((x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : { value: x }));
  if (!items.length) fail("There are no records.");
  return objectsToRows(items).map((r, i) => (i ? r.map((c) => (c && typeof c === "object" ? JSON.stringify(c) : c)) : r));
}
export function rowsToTree(rows: Rows): Record<string, unknown>[] {
  const [h, ...b] = rows; if (!h) return [];
  const head = h.map((x, i) => String(x ?? "") || `column${i + 1}`);
  return b.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] === "" || r[i] === undefined ? null : typeof r[i] === "string" ? autoType(r[i] as string) : r[i]])));
}
export function htmlTables(s: string): Rows {
  const t = s.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? fail("No table found in the HTML.");
  return [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim()));
}
export function mdTable(md: string): Rows {
  const lines = md.split(/\r?\n/).filter((l) => /^\s*\|.*\|\s*$/.test(l));
  return lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().slice(1, -1).split("|").map((c) => c.trim()));
}
/** INSERT INTO t (a,b) VALUES (...),(...); — parsed, never executed. */
export function sqlInserts(sql: string): Rows {
  const rows: Rows = []; let head: string[] | null = null;
  const re = /INSERT\s+INTO\s+[`"[]?[\w.]+[`"\]]?\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);/gi;
  for (const m of sql.matchAll(re)) {
    const cols = m[1]?.split(",").map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ""));
    const vals = parseSqlTuples(m[2]);
    if (!head) head = cols ?? vals[0]?.map((_, i) => `column${i + 1}`) ?? [];
    rows.push(...vals);
  }
  if (!head) fail("No INSERT statements were found in the SQL.");
  return [head!, ...rows];
}
function parseSqlTuples(s: string): unknown[][] {
  const out: unknown[][] = []; let i = 0;
  while (i < s.length) {
    if (s[i] !== "(") { i++; continue; }
    i++; const row: unknown[] = []; let cur = ""; let q = false; let quoted = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === "'" && s[i + 1] === "'") { cur += "'"; i++; } else if (c === "'") q = false; else cur += c; continue; }
      if (c === "'") { q = true; quoted = true; continue; }
      if (c === "," || c === ")") { const t = cur.trim(); row.push(quoted ? cur : /^null$/i.test(t) ? null : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : /^(true|false)$/i.test(t) ? /^t/i.test(t) : t); cur = ""; quoted = false; if (c === ")") { i++; break; } continue; }
      cur += c;
    }
    out.push(row);
  }
  return out;
}
const sqlVal = (v: unknown) => v === null || v === undefined || v === "" ? "NULL" : typeof v === "number" || typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
export function rowsToSql(rows: Rows, table = "data"): string {
  const [h, ...b] = rows; const q = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;
  const types = h.map((_, i) => (b.every((r) => r[i] === "" || r[i] == null || typeof r[i] === "number") ? "NUMERIC" : "TEXT"));
  return `CREATE TABLE ${q(table)} (${h.map((c, i) => `${q(c)} ${types[i]}`).join(", ")});\n${b.map((r) => `INSERT INTO ${q(table)} (${h.map(q).join(", ")}) VALUES (${h.map((_, i) => sqlVal(r[i])).join(", ")});`).join("\n")}\n`;
}

// ---------- ODS / ODT / ODP / PPTX (zip + XML) ----------
function unzipSafe(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0, n = 0;
  const out = unzipSync(bytes, { filter: (f) => { n++; total += f.originalSize; if (n > LIMITS.maxEntries || total > LIMITS.maxUnpacked) fail("The archive is too large when unpacked."); return true; } });
  for (const p of Object.keys(out)) if (p.startsWith("/") || p.split("/").includes("..") || /^[a-z]:/i.test(p)) fail("The archive contains unsafe paths and was rejected.");
  return out;
}
function odsRows(bytes: Uint8Array): Rows {
  const z = unzipSafe(bytes); const c = z["content.xml"] ?? fail("This is not a valid ODS file.");
  const s = dec(c); const t = s.match(/<table:table\b[\s\S]*?<\/table:table>/)?.[0] ?? fail("The spreadsheet has no sheet.");
  return [...t.matchAll(/<table:table-row\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)].map((r) => {
    const cells: unknown[] = [];
    for (const m of (r[1] ?? "").matchAll(/<table:table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)) {
      const rep = Math.min(Number(m[1].match(/number-columns-repeated="(\d+)"/)?.[1] ?? 1), 512);
      const num = m[1].match(/office:value-type="(?:float|percentage|currency)"[^>]*office:value="([^"]+)"/)?.[1] ?? m[1].match(/office:value="([^"]+)"/)?.[1];
      const text = [...(m[2] ?? "").matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)].map((p) => xmlText(p[1])).join("\n");
      for (let i = 0; i < rep; i++) cells.push(num !== undefined ? Number(num) : text);
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
  }).filter((r) => r.length);
}
const xmlText = (s: string) => s.replace(/<text:s[^>]*\/>/g, " ").replace(/<text:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
export function writeOds(rows: Rows, name = "Sheet1"): Uint8Array {
  const cell = (v: unknown) => typeof v === "number" && isFinite(v) ? `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${esc(v)}</text:p></table:table-cell>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="${esc(name)}">${rows.map((r) => `<table:table-row>${r.map(cell).join("")}</table:table-row>`).join("")}</table:table></office:spreadsheet></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  return zipSync({ mimetype: [strToU8("application/vnd.oasis.opendocument.spreadsheet"), { level: 0 }], "content.xml": strToU8(content), "META-INF/manifest.xml": strToU8(manifest) });
}
function odfText(bytes: Uint8Array): string {
  const z = unzipSafe(bytes); const c = z["content.xml"] ?? fail("This is not a valid OpenDocument file.");
  const s = dec(c);
  return [...s.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g)].map((m) => (m[1] === "h" ? `${"#".repeat(Math.min(6, Number(m[2].match(/outline-level="(\d)"/)?.[1] ?? 1)))} ` : "") + xmlText(m[3])).filter((l) => l.trim()).join("\n\n");
}
function pptxText(bytes: Uint8Array): string {
  const z = unzipSafe(bytes);
  const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!slides.length) fail("This is not a valid PowerPoint (.pptx) file.");
  return slides.map((k, i) => { const paras = [...dec(z[k]).matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => xmlText(t[1])).join("")).filter(Boolean); return `## Slide ${i + 1}${paras[0] ? `: ${paras[0]}` : ""}\n\n${paras.slice(1).map((p) => `- ${p}`).join("\n")}`; }).join("\n\n");
}
function odpText(bytes: Uint8Array): string {
  const s = dec(unzipSafe(bytes)["content.xml"] ?? fail("This is not a valid ODP file."));
  return [...s.matchAll(/<draw:page\b[\s\S]*?<\/draw:page>/g)].map((p, i) => { const paras = [...p[0].matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)].map((m) => xmlText(m[1])).filter(Boolean); return `## Slide ${i + 1}${paras[0] ? `: ${paras[0]}` : ""}\n\n${paras.slice(1).map((x) => `- ${x}`).join("\n")}`; }).join("\n\n");
}
export function rtfText(s: string): string {
  if (!s.startsWith("{\\rtf")) fail("This is not a valid RTF file.");
  let out = "", depth = 0; const skip: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") { depth++; continue; }
    if (c === "}") { if (skip.length && skip[skip.length - 1] === depth) skip.pop(); depth--; continue; }
    if (c === "\\") {
      const m = s.slice(i + 1).match(/^([a-z]+)(-?\d+)? ?|^'([0-9a-f]{2})|^u(-?\d+)\??|^([\\{}*~-])/i);
      if (!m) continue;
      i += m[0].length;
      if (skip.length) continue;
      if (m[1] && /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|generator)$/.test(m[1])) { skip.push(depth); continue; }
      if (m[5] === "*") { skip.push(depth); continue; }
      if (m[1] === "par" || m[1] === "line") out += "\n"; else if (m[1] === "tab") out += "\t";
      else if (m[1] === "u") { out += String.fromCharCode(((Number(m[2]) % 65536) + 65536) % 65536); if (s[i + 1] === "?") i++; }
      else if (m[3]) out += String.fromCharCode(parseInt(m[3], 16)); else if (m[5] && "\\{}".includes(m[5])) out += m[5];
      continue;
    }
    if (skip.length || c === "\r" || c === "\n") continue;
    out += c;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
export function textToRtf(md: string): string {
  const enc = (t: string) => [...t].map((ch) => { const n = ch.codePointAt(0)!; if (ch === "\\" || ch === "{" || ch === "}") return `\\${ch}`; if (n < 128) return ch; if (n > 0xffff) { const h = Math.floor((n - 0x10000) / 0x400) + 0xd800, l = ((n - 0x10000) % 0x400) + 0xdc00; return `\\u${h - 65536}?\\u${l - 65536}?`; } return `\\u${n > 32767 ? n - 65536 : n}?`; }).join("");
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs22 ${md.split(/\r?\n/).map((l) => { const h = l.match(/^(#{1,6})\s+(.*)/); return h ? `{\\b\\fs${36 - h[1].length * 3} ${enc(h[2])}}\\par` : `${enc(l.replace(/\*\*/g, ""))}\\par`; }).join("\n")}}`;
}

// ---------- config trees ----------
export function parseIni(s: string): Record<string, unknown> {
  const out: Record<string, any> = {}; let sec: Record<string, any> = out;
  for (const raw of s.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l.startsWith(";") || l.startsWith("#")) continue;
    const h = l.match(/^\[([^\]]+)\]$/); if (h) { sec = out[h[1].trim()] ??= {}; continue; }
    const m = l.match(/^([^=:]+?)\s*[=:]\s*(.*)$/); if (m) sec[m[1].trim()] = autoType(m[2].replace(/^"(.*)"$/, "$1"));
  }
  return out;
}
export function toIni(v: unknown): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("INI needs key/value sections, not a list.");
  const top: string[] = [], secs: string[] = [];
  for (const [k, x] of Object.entries(v as object)) {
    if (x && typeof x === "object" && !Array.isArray(x)) secs.push(`[${k}]\n${Object.entries(x).map(([a, b]) => `${a} = ${typeof b === "object" ? JSON.stringify(b) : b}`).join("\n")}`);
    else top.push(`${k} = ${Array.isArray(x) ? JSON.stringify(x) : x}`);
  }
  return [top.join("\n"), ...secs].filter(Boolean).join("\n\n") + "\n";
}
export function parseProps(s: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = s.replace(/\\\r?\n\s*/g, "").split(/\r?\n/);
  for (const raw of lines) {
    const l = raw.trim(); if (!l || l.startsWith("#") || l.startsWith("!")) continue;
    const m = l.replace(/^export\s+/, "").match(/^((?:\\.|[^=:\s])+)\s*[=:\s]\s*(.*)$/); if (!m) continue;
    out[m[1].replace(/\\(.)/g, "$1")] = m[2].replace(/^"(.*)"$|^'(.*)'$/, "$1$2").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return out;
}
function flat(v: unknown, pre = "", out: Record<string, string> = {}): Record<string, string> {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) flat(x, pre ? `${pre}.${k}` : k, out); else out[pre] = v == null ? "" : String(v);
  return out;
}
const toProps = (v: unknown) => Object.entries(flat(v)).map(([k, x]) => `${k.replace(/([=: ])/g, "\\$1")}=${[...x].map((c) => (c.charCodeAt(0) > 126 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c)).join("")}`).join("\n") + "\n";
const toEnv = (v: unknown) => Object.entries(flat(v)).map(([k, x]) => `${k.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}=${/[\s#"'$]/.test(x) ? JSON.stringify(x) : x}`).join("\n") + "\n";
export const SECRETISH = /(pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential)/i;

// ---------- subtitles ----------
const ts = (s: string) => { const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/) ?? fail(`Bad timestamp "${s}".`); return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number((m[4] ?? "0").padEnd(3, "0")); };
const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
const fmtT = (ms: number, sep: string, hw = 2) => `${pad(ms / 3600000, hw)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
export function parseSubs(fmt: string, s: string): Cue[] {
  const t = s.replace(/\r/g, "");
  let cues: Cue[] = [];
  if (fmt === "srt" || fmt === "vtt") {
    for (const block of t.split(/\n{2,}/)) {
      const lines = block.split("\n"); const i = lines.findIndex((l) => l.includes("-->")); if (i < 0) continue;
      const [a, b] = lines[i].split("-->"); cues.push({ start: ts(a), end: ts(b.trim().split(/\s+/)[0]), text: lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim() });
    }
  } else if (fmt === "ass" || fmt === "ssa") {
    const fmtLine = t.match(/^\[Events\][\s\S]*?^Format:\s*(.*)$/m)?.[1]?.split(",").map((x) => x.trim().toLowerCase()) ?? ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
    for (const m of t.matchAll(/^Dialogue:\s*(.*)$/gm)) {
      const parts = m[1].split(","); const ti = fmtLine.indexOf("text");
      const f = (k: string) => parts[fmtLine.indexOf(k)];
      cues.push({ start: ts(f("start")), end: ts(f("end")), text: parts.slice(ti).join(",").replace(/\{[^}]*\}/g, "").replace(/\\N/gi, "\n").trim() });
    }
  } else if (fmt === "lrc") {
    const lines: { start: number; text: string }[] = [];
    for (const l of t.split("\n")) { const stamps = [...l.matchAll(/\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\]/g)]; const text = l.replace(/\[[^\]]*\]/g, "").trim(); for (const st of stamps) lines.push({ start: ts(st[1].replace(/:(\d+)$/, ".$1").replace(/^(\d+:\d+)\.(\d+)$/, "$1.$2")), text }); }
    lines.sort((a, b) => a.start - b.start);
    cues = lines.map((l, i) => ({ start: l.start, end: lines[i + 1]?.start ?? l.start + 4000, text: l.text })).filter((c) => c.text);
  }
  if (!cues.length) fail(`No subtitle cues were found in this ${fmt.toUpperCase()} file.`);
  return cues;
}
export function writeSubs(fmt: string, cues: Cue[]): string {
  switch (fmt) {
    case "srt": return cues.map((c, i) => `${i + 1}\n${fmtT(c.start, ",")} --> ${fmtT(c.end, ",")}\n${c.text}`).join("\n\n") + "\n";
    case "vtt": return `WEBVTT\n\n${cues.map((c) => `${fmtT(c.start, ".")} --> ${fmtT(c.end, ".")}\n${c.text}`).join("\n\n")}\n`;
    case "ass": case "ssa": {
      const t = (ms: number) => `${Math.floor(ms / 3600000)}:${pad((ms / 60000) % 60)}:${pad((ms / 1000) % 60)}.${pad((ms % 1000) / 10)}`;
      const v4 = fmt === "ass" ? "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1" : "[V4 Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding\nStyle: Default,Arial,20,16777215,255,0,0,0,0,1,2,0,2,10,10,10,0,1";
      const lead = fmt === "ass" ? "0" : "Marked=0";
      return `[Script Info]\nScriptType: ${fmt === "ass" ? "v4.00+" : "v4.00"}\n\n${v4}\n\n[Events]\nFormat: ${fmt === "ass" ? "Layer" : "Marked"}, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${cues.map((c) => `Dialogue: ${lead},${t(c.start)},${t(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`).join("\n")}\n`;
    }
    case "lrc": return cues.map((c) => `[${pad(c.start / 60000)}:${pad((c.start / 1000) % 60)}.${pad((c.start % 1000) / 10)}]${c.text.replace(/\n/g, " ")}`).join("\n") + "\n";
    case "json": return JSON.stringify(cues, null, 2);
    default: return cues.map((c) => c.text).join("\n") + "\n";
  }
}

// ---------- contacts & calendars ----------
function unfold(s: string) { return s.replace(/\r?\n[ \t]/g, "").split(/\r?\n/); }
const icsUnesc = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
export function parseVcf(s: string): Record<string, unknown>[] {
  const out: Record<string, any>[] = []; let cur: Record<string, any> | null = null;
  for (const l of unfold(s)) {
    if (/^BEGIN:VCARD/i.test(l)) { cur = {}; continue; }
    if (/^END:VCARD/i.test(l)) { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = l.match(/^(?:[\w-]+\.)?([\w-]+)((?:;[^:]*)?):(.*)$/); if (!m) continue;
    const key = m[1].toUpperCase(), type = m[2].match(/TYPE=([^;:]+)/i)?.[1]?.toLowerCase(), val = icsUnesc(m[3]);
    const name = ({ FN: "name", N: "structured_name", EMAIL: "email", TEL: "phone", ORG: "organization", TITLE: "title", ADR: "address", URL: "url", BDAY: "birthday", NOTE: "note" } as any)[key];
    if (!name) continue;
    const k = type && (key === "EMAIL" || key === "TEL") ? `${name}_${type.split(",")[0]}` : name;
    cur[k] = cur[k] ? `${cur[k]}; ${val}` : key === "ADR" || key === "N" ? val.split(";").filter(Boolean).join(", ") : val;
  }
  if (!out.length) fail("No contacts (BEGIN:VCARD) were found.");
  return out;
}
export function writeVcf(items: Record<string, unknown>[]): string {
  const e = (v: unknown) => String(v ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  return items.map((c) => { const get = (...ks: string[]) => ks.map((k) => Object.entries(c).find(([x]) => x.toLowerCase() === k)?.[1]).find((v) => v != null && v !== ""); const name = get("name", "full name", "fn") ?? "Unnamed";
    return ["BEGIN:VCARD", "VERSION:3.0", `FN:${e(name)}`, `N:${e(name)};;;;`, get("email") ? `EMAIL:${e(get("email"))}` : "", get("phone", "tel", "mobile") ? `TEL:${e(get("phone", "tel", "mobile"))}` : "", get("organization", "org", "company") ? `ORG:${e(get("organization", "org", "company"))}` : "", get("title") ? `TITLE:${e(get("title"))}` : "", "END:VCARD"].filter(Boolean).join("\r\n"); }).join("\r\n") + "\r\n";
}
const icsDate = (v: string) => { const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/); return m ? (m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}` : `${m[1]}-${m[2]}-${m[3]}`) : v; };
export function parseIcs(s: string): Record<string, unknown>[] {
  const out: Record<string, any>[] = []; let cur: Record<string, any> | null = null;
  for (const l of unfold(s)) {
    if (/^BEGIN:VEVENT/i.test(l)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(l)) { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = l.match(/^([\w-]+)((?:;[^:]*)?):(.*)$/); if (!m) continue;
    const k = ({ SUMMARY: "title", DTSTART: "start", DTEND: "end", LOCATION: "location", DESCRIPTION: "description", UID: "uid", RRULE: "repeat", STATUS: "status" } as any)[m[1].toUpperCase()];
    if (k) { cur[k] = k === "start" || k === "end" ? icsDate(m[3]) : icsUnesc(m[3]); const tz = m[2].match(/TZID=([^;:]+)/i)?.[1]; if (tz && (k === "start")) cur.timezone = tz; }
  }
  if (!out.length) fail("No events (BEGIN:VEVENT) were found.");
  return out;
}
export function writeIcs(items: Record<string, unknown>[]): string {
  const e = (v: unknown) => String(v ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
  const d = (v: unknown) => { const s = String(v ?? ""); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z)?)?/); if (!m) fail(`"${s}" is not a date (use YYYY-MM-DD or YYYY-MM-DDTHH:MM).`); return m![4] ? `:${m![1]}${m![2]}${m![3]}T${m![4]}${m![5]}${m![6] ?? "00"}${m![7] ?? ""}` : `;VALUE=DATE:${m![1]}${m![2]}${m![3]}`; };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VISION//EN", ...items.flatMap((x, i) => { const g = (k: string) => Object.entries(x).find(([a]) => a.toLowerCase() === k)?.[1];
    return ["BEGIN:VEVENT", `UID:${g("uid") ?? `${stamp}-${i}@vision`}`, `DTSTAMP:${stamp}`, `DTSTART${d(g("start") ?? g("date"))}`, g("end") ? `DTEND${d(g("end"))}` : "", `SUMMARY:${e(g("title") ?? g("summary") ?? "Event")}`, g("location") ? `LOCATION:${e(g("location"))}` : "", g("description") ? `DESCRIPTION:${e(g("description"))}` : "", "END:VEVENT"].filter(Boolean); }), "END:VCALENDAR"].join("\r\n") + "\r\n";
}

// ---------- geo ----------
const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
export function parseGeo(fmt: string, s: string): Feature[] {
  if (fmt === "geojson") {
    const v = JSON.parse(s);
    const feats = v.type === "FeatureCollection" ? v.features : v.type === "Feature" ? [v] : v.type ? [{ type: "Feature", geometry: v, properties: {} }] : fail("This is not GeoJSON.");
    return feats.filter((x: any) => ["Point", "LineString", "Polygon"].includes(x?.geometry?.type)).map((x: any) => ({ type: "Feature", geometry: x.geometry, properties: x.properties ?? {} }));
  }
  const doc = safeXml(s);
  const out: Feature[] = [];
  if (fmt === "gpx") {
    const g = doc.gpx ?? fail("This is not a GPX file.");
    const pt = (p: any) => [Number(p["@lon"]), Number(p["@lat"]), ...(p.ele != null ? [Number(p.ele)] : [])];
    for (const w of arr(g.wpt)) out.push({ type: "Feature", geometry: { type: "Point", coordinates: pt(w) }, properties: { name: (w as any).name ?? "", time: (w as any).time ?? "" } });
    for (const t of arr(g.trk)) for (const sg of arr((t as any).trkseg)) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: arr((sg as any).trkpt).map(pt) }, properties: { name: (t as any).name ?? "track" } });
    for (const r of arr(g.rte)) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: arr((r as any).rtept).map(pt) }, properties: { name: (r as any).name ?? "route" } });
  } else {
    const coords = (c: unknown) => String(c ?? "").trim().split(/\s+/).filter(Boolean).map((t) => t.split(",").map(Number));
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      for (const pm of arr(n.Placemark)) {
        const p: any = pm; const props = { name: p.name ?? "", description: p.description ?? "" };
        const geoms = [...arr(p.Point).map((g: any) => ({ type: "Point" as const, coordinates: coords(g.coordinates)[0] })), ...arr(p.LineString).map((g: any) => ({ type: "LineString" as const, coordinates: coords(g.coordinates) })), ...arr(p.Polygon).map((g: any) => ({ type: "Polygon" as const, coordinates: [coords(g.outerBoundaryIs?.LinearRing?.coordinates)] })), ...arr(p.MultiGeometry).flatMap((m: any) => arr(m.Point).map((g: any) => ({ type: "Point" as const, coordinates: coords(g.coordinates)[0] })))];
        for (const geometry of geoms) out.push({ type: "Feature", geometry, properties: props });
      }
      for (const k of ["Document", "Folder"]) arr(n[k]).forEach(walk);
    };
    walk(doc.kml ?? fail("This is not a KML file."));
  }
  if (!out.length) fail(`No points, lines or shapes were found in this ${fmt.toUpperCase()} file.`);
  return out;
}
export function writeGeo(fmt: string, feats: Feature[]): string {
  if (fmt === "geojson") return JSON.stringify({ type: "FeatureCollection", features: feats }, null, 2);
  if (fmt === "csv") return toCsv([["name", "type", "longitude", "latitude", "elevation", "points"], ...feats.map((f) => { const c = f.geometry.type === "Point" ? f.geometry.coordinates : f.geometry.type === "LineString" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]; return [f.properties.name ?? "", f.geometry.type, c?.[0], c?.[1], c?.[2] ?? "", f.geometry.type === "Point" ? 1 : (f.geometry.type === "LineString" ? f.geometry.coordinates : f.geometry.coordinates[0]).length]; })]);
  if (fmt === "kml") {
    const c = (p: number[]) => p.join(",");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${feats.map((f) => `<Placemark><name>${esc(f.properties.name)}</name>${f.geometry.type === "Point" ? `<Point><coordinates>${c(f.geometry.coordinates)}</coordinates></Point>` : f.geometry.type === "LineString" ? `<LineString><coordinates>${f.geometry.coordinates.map(c).join(" ")}</coordinates></LineString>` : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${f.geometry.coordinates[0].map(c).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`}</Placemark>`).join("")}</Document></kml>\n`;
  }
  const pt = (tag: string, p: number[]) => `<${tag} lat="${p[1]}" lon="${p[0]}">${p[2] != null ? `<ele>${p[2]}</ele>` : ""}</${tag}>`;
  const wpts = feats.filter((f) => f.geometry.type === "Point").map((f) => pt("wpt", f.geometry.coordinates).replace("</wpt>", `<name>${esc(f.properties.name)}</name></wpt>`));
  const trks = feats.filter((f) => f.geometry.type !== "Point").map((f) => `<trk><name>${esc(f.properties.name)}</name><trkseg>${(f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates).map((p: number[]) => pt("trkpt", p)).join("")}</trkseg></trk>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VISION" xmlns="http://www.topografix.com/GPX/1/1">${wpts.join("")}${trks.join("")}</gpx>\n`;
}

// ---------- archives ----------
export function readTar(b: Uint8Array): { path: string; bytes: Uint8Array }[] {
  const out: { path: string; bytes: Uint8Array }[] = []; let o = 0, total = 0, longName = "";
  while (o + 512 <= b.length) {
    const h = b.subarray(o, o + 512); if (h.every((x) => x === 0)) break;
    const str = (s: number, n: number) => strFromU8(h.subarray(s, s + n)).replace(/\0.*$/s, "");
    const size = parseInt(str(124, 12).trim() || "0", 8); const type = String.fromCharCode(h[156] || 48);
    if (!Number.isFinite(size) || size < 0) fail("The TAR archive is damaged.");
    const name = longName || ((str(345, 155) ? `${str(345, 155)}/` : "") + str(0, 100)); longName = "";
    const data = b.subarray(o + 512, o + 512 + size); o += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = strFromU8(data).replace(/\0.*$/s, ""); continue; }
    if (type === "1" || type === "2") fail("The archive contains links and was rejected.");
    if (type !== "0" && type !== "\0" && type !== "7") continue;
    if (name.startsWith("/") || name.split("/").includes("..") || /^[a-z]:/i.test(name)) fail("The archive contains unsafe paths and was rejected.");
    total += size; if (out.length >= LIMITS.maxEntries || total > LIMITS.maxUnpacked) fail("The archive is too large when unpacked.");
    out.push({ path: name, bytes: data.slice() });
  }
  return out;
}
export function writeTar(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const h = new Uint8Array(512); const put = (s: string, at: number, n: number) => h.set(strToU8(s).subarray(0, n), at);
    let p = f.path; if (strToU8(p).length > 100) { const L = strToU8(p + "\0"); const lh = new Uint8Array(512); lh.set(strToU8("././@LongLink"), 0); lh.set(strToU8("0000644\0"), 100); lh.set(strToU8(L.length.toString(8).padStart(11, "0") + "\0"), 124); lh[156] = 76; lh.set(strToU8("ustar\x0000"), 257); lh.set(strToU8("        "), 148); lh.set(strToU8(lh.reduce((a, x) => a + x, 0).toString(8).padStart(6, "0") + "\0 "), 148); parts.push(lh, L, new Uint8Array((512 - (L.length % 512)) % 512)); p = p.slice(0, 99); }
    put(p, 0, 100); put("0000644\0", 100, 8); put("0000000\0", 108, 8); put("0000000\0", 116, 8); put(f.bytes.length.toString(8).padStart(11, "0") + "\0", 124, 12); put(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12); h[156] = 48; put("ustar\x0000", 257, 8); put("        ", 148, 8);
    put(h.reduce((a, x) => a + x, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
    parts.push(h, f.bytes, new Uint8Array((512 - (f.bytes.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
function gunzipSafe(b: Uint8Array): Uint8Array { const isize = b.length >= 4 ? (b[b.length - 4] | (b[b.length - 3] << 8) | (b[b.length - 2] << 16) | (b[b.length - 1] << 24)) >>> 0 : 0; if (isize > LIMITS.maxUnpacked) fail("The file is too large when decompressed."); try { return gunzipSync(b); } catch { return fail("The gzip data is damaged."); } }

// ---------- notebooks, logs, diffs, drawio, fonts, dxf ----------
export function notebookMd(s: string): { md: string; py: string; cells: number } {
  const nb = JSON.parse(s); if (!Array.isArray(nb.cells)) fail("This is not a Jupyter notebook.");
  const lang = nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? "python";
  const src = (c: any) => (Array.isArray(c.source) ? c.source.join("") : String(c.source ?? ""));
  const md = nb.cells.map((c: any) => c.cell_type === "markdown" ? src(c) : c.cell_type === "code" ? `\`\`\`${lang}\n${src(c)}\n\`\`\`${(c.outputs ?? []).map((o: any) => { const t = o.text ?? o.data?.["text/plain"]; return t ? `\n\n\`\`\`text\n${(Array.isArray(t) ? t.join("") : t).trim()}\n\`\`\`` : ""; }).join("")}` : src(c)).join("\n\n");
  const py = nb.cells.map((c: any) => c.cell_type === "code" ? `# %%\n${src(c)}` : `# %% [markdown]\n${src(c).split("\n").map((l: string) => `# ${l}`).join("\n")}`).join("\n\n") + "\n";
  return { md, py, cells: nb.cells.length };
}
export function parseLog(s: string): Rows {
  const rows: Rows = [["line", "time", "level", "message"]];
  s.split(/\r?\n/).forEach((l, i) => { if (!l.trim()) return; const t = l.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\[\d{2}\/\w{3}\/\d{4}:[^\]]+\])/)?.[1] ?? ""; const lv = l.match(/\b(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|ERR|FATAL|CRITICAL)\b/i)?.[1]?.toUpperCase().replace("WARNING", "WARN").replace(/^ERR$/, "ERROR") ?? ""; rows.push([i + 1, t, lv, l.replace(t, "").replace(/^[\s\-|:\]]+/, "").trim()]); });
  return rows;
}
export function parseDiff(s: string) {
  const files: { file: string; added: number; removed: number; hunks: number }[] = []; let cur: (typeof files)[number] | null = null;
  for (const l of s.split(/\r?\n/)) {
    if (l.startsWith("diff --git") || (l.startsWith("--- ") && !cur)) { cur = { file: l.replace(/^diff --git a\/(\S+).*$/, "$1").replace(/^--- (a\/)?/, ""), added: 0, removed: 0, hunks: 0 }; files.push(cur); continue; }
    if (l.startsWith("+++ ") && cur) { const n = l.slice(4).replace(/^b\//, "").split("\t")[0]; if (n !== "/dev/null") cur.file = n; continue; }
    if (l.startsWith("--- ")) continue;
    if (l.startsWith("@@") && cur) cur.hunks++; else if (cur && l.startsWith("+")) cur.added++; else if (cur && l.startsWith("-")) cur.removed++;
  }
  if (!files.length) fail("No changes were found in this diff.");
  return files;
}
export function parseDrawio(s: string): { nodes: { id: string; label: string }[]; edges: { from: string; to: string; label: string }[] } {
  let x = s;
  const d = s.match(/<diagram[^>]*>([^<]+)<\/diagram>/)?.[1]?.trim();
  if (d && !s.includes("<mxGraphModel")) { try { x = decodeURIComponent(strFromU8(inflateSync(Uint8Array.from(atob(d), (c) => c.charCodeAt(0))))); } catch { fail("The compressed draw.io diagram could not be decoded."); } }
  if (!x.includes("mxCell")) fail("This is not a draw.io diagram.");
  const strip = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const nodes: { id: string; label: string }[] = [], edges: { from: string; to: string; label: string }[] = [];
  for (const m of x.matchAll(/<mxCell\b([^>]*)>/g)) {
    const a = (k: string) => m[1].match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? "";
    if (a("edge") === "1") edges.push({ from: a("source"), to: a("target"), label: strip(a("value")) });
    else if (a("vertex") === "1") nodes.push({ id: a("id"), label: strip(a("value")) || a("id") });
  }
  return { nodes, edges };
}
export function fontInfo(b: Uint8Array) {
  const sig = strFromU8(b.subarray(0, 4));
  let sfnt = b;
  if (sig === "wOFF") sfnt = woffToSfnt(b);
  else if (sig === "wOF2") return { format: "WOFF2", note: "Brotli-compressed; details are read on the runtime." };
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength); const n = dv.getUint16(4);
  const tables: Record<string, { o: number; l: number }> = {};
  for (let i = 0; i < n; i++) { const r = 12 + i * 16; tables[strFromU8(sfnt.subarray(r, r + 4))] = { o: dv.getUint32(r + 8), l: dv.getUint32(r + 12) }; }
  const names: Record<number, string> = {};
  if (tables.name) { const t = tables.name.o, cnt = dv.getUint16(t + 2), so = t + dv.getUint16(t + 4);
    for (let i = 0; i < cnt; i++) { const r = t + 6 + i * 12, pid = dv.getUint16(r), id = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10); const raw = sfnt.subarray(so + off, so + off + len);
      if (pid === 3 || pid === 0) { let s = ""; for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode((raw[j] << 8) | raw[j + 1]); names[id] = s; } else names[id] ??= strFromU8(raw); } }
  return { format: sig === "wOFF" ? "WOFF" : sig === "OTTO" ? "OpenType (CFF)" : "TrueType", outlines: "CFF " in tables || "CFF2" in tables ? "cff" : "truetype", family: names[1], style: names[2], fullName: names[4], version: names[5], glyphs: tables.maxp ? dv.getUint16(tables.maxp.o + 4) : undefined, tables: Object.keys(tables) };
}
export function woffToSfnt(b: Uint8Array): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (strFromU8(b.subarray(0, 4)) !== "wOFF") fail("This is not a WOFF font.");
  const flavor = dv.getUint32(4), n = dv.getUint16(12), total = dv.getUint32(16);
  if (total > 50 * 1024 * 1024) fail("The font is too large.");
  const out = new Uint8Array(total); const o = new DataView(out.buffer);
  o.setUint32(0, flavor); o.setUint16(4, n); let es = 0; while (1 << (es + 1) <= n) es++; o.setUint16(6, (1 << es) * 16); o.setUint16(8, es); o.setUint16(10, n * 16 - (1 << es) * 16);
  let off = 12 + n * 16;
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20, tag = dv.getUint32(r), to = dv.getUint32(r + 4), cl = dv.getUint32(r + 8), ol = dv.getUint32(r + 12), ck = dv.getUint32(r + 16);
    const data = cl < ol ? unzlibSync(b.subarray(to, to + cl)) : b.subarray(to, to + ol);
    if (data.length !== ol) fail("The WOFF font is damaged.");
    const w = 12 + i * 16; o.setUint32(w, tag); o.setUint32(w + 4, ck); o.setUint32(w + 8, off); o.setUint32(w + 12, ol);
    out.set(data, off); off += (ol + 3) & ~3;
  }
  return out;
}
export function dxfInfo(s: string) {
  const lines = s.split(/\r?\n/).map((l) => l.trim()); const counts: Record<string, number> = {}; const layers = new Set<string>(); let inEnt = false;
  if (!lines.includes("SECTION")) fail("This is not a DXF drawing.");
  for (let i = 0; i + 1 < lines.length; i += 2) { const code = lines[i], v = lines[i + 1];
    if (code === "2" && lines[i - 1] === "SECTION") inEnt = v === "ENTITIES"; else if (code === "0" && v === "ENDSEC") inEnt = false;
    else if (inEnt && code === "0") counts[v] = (counts[v] ?? 0) + 1; else if (inEnt && code === "8") layers.add(v); }
  return { version: lines[lines.indexOf("$ACADVER") + 2], entities: counts, layers: [...layers] };
}
export function svgInfo(s: string) {
  const root = s.match(/<svg\b[^>]*>/i)?.[0] ?? fail("This is not an SVG image.");
  const a = (k: string) => root.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
  return { width: a("width"), height: a("height"), viewBox: a("viewBox"), elements: (s.match(/<[a-z][\w:-]*/gi) ?? []).length, hasScripts: /<script\b|\son\w+\s*=/i.test(s), externalRefs: /(href|src)\s*=\s*"(https?:|\/\/)/i.test(s) };
}

// ---------- read: bytes → intermediate ----------
export function read(from: string, name: string, bytes: Uint8Array): Inter {
  if (!bytes.length) fail("The file is empty.");
  const s = () => dec(bytes);
  const title = name.replace(/\.[^.]+$/, "") || "Document";
  switch (from) {
    case "csv": return { kind: "table", rows: parseCsv(s(), ",") };
    case "tsv": return { kind: "table", rows: parseCsv(s(), "\t") };
    case "xlsx": { const sh = readXlsx(bytes, LIMITS.maxRows); return { kind: "table", rows: sh[0]?.rows ?? fail("The workbook has no sheets.") }; }
    case "ods": return { kind: "table", rows: odsRows(bytes) };
    case "sql": return { kind: "table", rows: sqlInserts(s()) };
    case "json": try { return { kind: "tree", value: JSON.parse(s()) }; } catch (e) { return fail(`Invalid JSON: ${(e as Error).message}`); }
    case "jsonl": return { kind: "tree", value: s().split(/\r?\n/).filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { return fail(`Line ${i + 1} is not valid JSON.`); } }) };
    case "yaml": try { return { kind: "tree", value: YAML.parse(s(), { maxAliasCount: 100 }) }; } catch (e) { return fail(`Invalid YAML: ${(e as Error).message.split("\n")[0]}`); }
    case "toml": try { return { kind: "tree", value: TOML.parse(s()) }; } catch (e) { return fail(`Invalid TOML: ${(e as Error).message.split("\n")[0]}`); }
    case "xml": try { return { kind: "tree", value: safeXml(s()) }; } catch (e) { if (e instanceof FormatError) throw e; return fail("Invalid XML."); }
    case "ini": case "cfg": case "conf": return { kind: "tree", value: parseIni(s()) };
    case "properties": case "env": return { kind: "tree", value: parseProps(s()) };
    case "srt": case "vtt": case "ass": case "ssa": case "lrc": return { kind: "cues", cues: parseSubs(from, s()) };
    case "vcf": return { kind: "tree", value: parseVcf(s()) };
    case "ics": return { kind: "tree", value: parseIcs(s()) };
    case "gpx": case "kml": case "geojson": return { kind: "geo", features: parseGeo(from, s()) };
    case "log": return { kind: "table", rows: parseLog(s()) };
    case "diff": case "patch": { const files = parseDiff(s()); return { kind: "doc", title, md: `# ${title}\n\n| File | Added | Removed | Hunks |\n|---|---|---|---|\n${files.map((f) => `| ${f.file} | ${f.added} | ${f.removed} | ${f.hunks} |`).join("\n")}\n\n\`\`\`diff\n${s()}\n\`\`\`` }; }
    case "ipynb": return { kind: "doc", title, md: notebookMd(s()).md };
    case "rtf": return { kind: "doc", title, md: rtfText(s()) };
    case "odt": return { kind: "doc", title, md: odfText(bytes) };
    case "pptx": return { kind: "doc", title, md: pptxText(bytes) };
    case "odp": return { kind: "doc", title, md: odpText(bytes) };
    case "fb2": { const x = s(); if (!/<FictionBook/i.test(x)) fail("This is not a FictionBook file."); const t = x.match(/<book-title>([\s\S]*?)<\/book-title>/)?.[1] ?? title; const body = x.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? ""; return { kind: "doc", title: xmlText(t), md: `# ${xmlText(t)}\n\n` + body.replace(/<title>([\s\S]*?)<\/title>/g, (_, h) => `\n\n## ${xmlText(h).trim()}\n\n`).replace(/<p>([\s\S]*?)<\/p>/g, (_, p) => `${xmlText(p)}\n\n`).replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim() }; }
    case "tex": { const x = s(); const body = x.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/)?.[1] ?? x; return { kind: "doc", title: x.match(/\\title\{([^}]*)\}/)?.[1] ?? title, md: body.replace(/%.*$/gm, "").replace(/\\(sub)*section\*?\{([^}]*)\}/g, (_, sub, h) => `\n${"#".repeat(2 + (sub ? sub.length / 3 : 0))} ${h}\n`).replace(/\\textbf\{([^}]*)\}/g, "**$1**").replace(/\\(emph|textit)\{([^}]*)\}/g, "*$2*").replace(/\\item\s*/g, "- ").replace(/\\(begin|end)\{[^}]*\}/g, "").replace(/\\maketitle|\\\\/g, "").replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{([^}]*)\})?/g, "$3").replace(/\n{3,}/g, "\n\n").trim() }; }
    case "mmd": case "puml": case "dot": case "svg": return { kind: "doc", title, md: s() };
    case "drawio": return { kind: "tree", value: parseDrawio(s()) };
    case "dxf": return { kind: "tree", value: dxfInfo(s()) };
    case "zip": case "cbz": return { kind: "files", files: Object.entries(unzipSafe(bytes)).filter(([p]) => !p.endsWith("/")).map(([path, b]) => ({ path, bytes: b })) };
    case "tar": return { kind: "files", files: readTar(bytes) };
    case "tgz": return { kind: "files", files: readTar(gunzipSafe(bytes)) };
    case "gz": { const inner = gunzipSafe(bytes); return strFromU8(inner.subarray(257, 262)) === "ustar" ? { kind: "files", files: readTar(inner) } : { kind: "files", files: [{ path: name.replace(/\.gz$/i, "") || "file", bytes: inner }] }; }
    case "woff": return { kind: "files", files: [{ path: name.replace(/\.woff$/i, ".ttf"), bytes: woffToSfnt(bytes) }] };
    default: return fail(`${from.toUpperCase()} can't be read inline.`);
  }
}

// ---------- write: intermediate → bytes (text documents are delegated to the document builder) ----------
export type Out = { name: string; mime: string; bytes: Uint8Array; note?: string } | { doc: { title: string; md: string; format: string } };
const T = (name: string, s: string, mime: string): Out => ({ name, mime, bytes: strToU8(s) });

function asRows(i: Inter): Rows {
  if (i.kind === "table") return i.rows.map((r, n) => (n ? r.map((c) => (typeof c === "string" ? autoType(c) : c)) : r));
  if (i.kind === "tree") return treeToRows(i.value);
  if (i.kind === "cues") return [["start", "end", "text"], ...i.cues.map((c) => [fmtT(c.start, "."), fmtT(c.end, "."), c.text])];
  if (i.kind === "geo") return parseCsv(writeGeo("csv", i.features), ",");
  if (i.kind === "doc") { const r = mdTable(i.md); if (r.length) return r; }
  return fail("This file has no table to convert.");
}
function asTree(i: Inter): unknown {
  if (i.kind === "tree") return i.value;
  if (i.kind === "table") return rowsToTree(i.rows);
  if (i.kind === "cues") return i.cues;
  if (i.kind === "geo") return { type: "FeatureCollection", features: i.features };
  if (i.kind === "files") return i.files.map((f) => ({ path: f.path, size: f.bytes.length }));
  return { title: i.title, text: i.md };
}
function asMd(i: Inter, title: string): string {
  if (i.kind === "doc") return i.md;
  if (i.kind === "cues") return `# ${title}\n\n${i.cues.map((c) => `**${fmtT(c.start, ".")}** ${c.text}`).join("\n\n")}`;
  if (i.kind === "files") return `# ${title}\n\n| Path | Size |\n|---|---|\n${i.files.map((f) => `| ${f.path} | ${f.bytes.length} |`).join("\n")}`;
  const rows = i.kind === "tree" ? (() => { try { return treeToRows(i.value); } catch { return null; } })() : i.kind === "geo" ? asRows(i) : i.rows;
  if (!rows) return `# ${title}\n\n\`\`\`json\n${JSON.stringify(i.kind === "tree" ? i.value : null, null, 2)}\n\`\`\``;
  const cell = (c: unknown) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return `# ${title}\n\n| ${rows[0].map(cell).join(" | ")} |\n| ${rows[0].map(() => "---").join(" | ")} |\n${rows.slice(1).map((r) => `| ${rows[0].map((_, j) => cell(r[j])).join(" | ")} |`).join("\n")}`;
}
function xmlOf(v: unknown): string {
  const root = Array.isArray(v) ? { records: { record: v } } : v && typeof v === "object" && Object.keys(v).length === 1 ? v : { root: v };
  return `<?xml version="1.0" encoding="UTF-8"?>\n` + new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@", format: true, suppressEmptyNode: true }).build(root);
}

export function write(to: string, i: Inter, base: string, from: string): Out {
  const n = (e: string) => `${base}.${e}`;
  switch (to) {
    case "csv": return i.kind === "geo" ? T(n("csv"), writeGeo("csv", i.features), "text/csv") : T(n("csv"), toCsv(asRows(i)), "text/csv");
    case "tsv": return T(n("tsv"), asRows(i).map((r) => r.map((c) => String(c ?? "").replace(/[\t\n\r]/g, " ")).join("\t")).join("\n") + "\n", "text/tab-separated-values");
    case "xlsx": return { name: n("xlsx"), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: writeXlsx([{ name: base.slice(0, 31) || "Sheet1", rows: asRows(i) }]) };
    case "ods": return { name: n("ods"), mime: "application/vnd.oasis.opendocument.spreadsheet", bytes: writeOds(asRows(i), base.slice(0, 31)) };
    case "sql": return T(n("sql"), rowsToSql(asRows(i), base.replace(/\W+/g, "_") || "data"), "application/sql");
    case "json": {
      if (from === "ipynb" && i.kind === "doc") return fail("The notebook is already JSON.");
      return T(n(i.kind === "geo" ? "json" : "json"), JSON.stringify(asTree(i), null, 2), "application/json");
    }
    case "jsonl": { const v = asTree(i); if (!Array.isArray(v)) return fail("Only a list of records can become JSON Lines."); return T(n("jsonl"), v.map((x) => JSON.stringify(x)).join("\n") + "\n", "application/x-ndjson"); }
    case "yaml": return T(n("yaml"), YAML.stringify(asTree(i)), "application/yaml");
    case "toml": { const v = asTree(i); if (!v || typeof v !== "object" || Array.isArray(v)) return T(n("toml"), TOML.stringify({ records: v as any[] }), "application/toml"); try { return T(n("toml"), TOML.stringify(v as any), "application/toml"); } catch (e) { return fail(`TOML can't represent this data: ${(e as Error).message}`); } }
    case "xml": return T(n("xml"), xmlOf(asTree(i)), "application/xml");
    case "ini": return T(n("ini"), toIni(asTree(i)), "text/plain");
    case "properties": return T(n("properties"), toProps(asTree(i)), "text/plain");
    case "env": return T(n("env"), toEnv(asTree(i)), "text/plain");
    case "srt": case "vtt": case "ass": case "ssa": case "lrc": if (i.kind !== "cues") return fail("Only subtitles can be converted to subtitle formats."); return T(n(to), writeSubs(to, i.cues), to === "vtt" ? "text/vtt" : "text/plain");
    case "geojson": case "kml": case "gpx": if (i.kind !== "geo") return fail("Only map data can be converted to map formats."); return T(n(to), writeGeo(to, i.features), to === "geojson" ? "application/geo+json" : to === "kml" ? "application/vnd.google-earth.kml+xml" : "application/gpx+xml");
    case "py": { if (from !== "ipynb") return fail("Only notebooks convert to Python here."); return fail("__ipynb_py__"); }
    case "dot": case "mmd": { if (i.kind !== "tree" || from !== "drawio") return fail(`Only draw.io diagrams convert to ${to.toUpperCase()} here.`); const g = i.value as ReturnType<typeof parseDrawio>; const id = (x: string) => `n${x.replace(/\W/g, "_")}`; const q = (s: string) => s.replace(/"/g, "'");
      return to === "dot" ? T(n("dot"), `digraph G {\n${g.nodes.map((x) => `  ${id(x.id)} [label="${q(x.label)}"];`).join("\n")}\n${g.edges.filter((e) => e.from && e.to).map((e) => `  ${id(e.from)} -> ${id(e.to)}${e.label ? ` [label="${q(e.label)}"]` : ""};`).join("\n")}\n}\n`, "text/vnd.graphviz")
        : T(n("mmd"), `flowchart TD\n${g.nodes.map((x) => `  ${id(x.id)}["${q(x.label)}"]`).join("\n")}\n${g.edges.filter((e) => e.from && e.to).map((e) => `  ${id(e.from)} -->${e.label ? `|${q(e.label)}|` : ""} ${id(e.to)}`).join("\n")}\n`, "text/plain"); }
    case "zip": case "cbz": if (i.kind !== "files") return fail("Only archives can be repackaged."); return { name: n(to), mime: "application/zip", bytes: zipSync(Object.fromEntries(i.files.map((f) => [f.path, f.bytes]))) };
    case "tar": if (i.kind !== "files") return fail("Only archives can be repackaged."); return { name: n("tar"), mime: "application/x-tar", bytes: writeTar(i.files) };
    case "tgz": if (i.kind !== "files") return fail("Only archives can be repackaged."); return { name: n("tgz"), mime: "application/gzip", bytes: gzipSync(writeTar(i.files)) };
    case "ttf": case "otf": { if (from !== "woff" || i.kind !== "files") return fail("Only WOFF unwraps inline."); const b = i.files[0].bytes; const cff = strFromU8(b.subarray(0, 4)) === "OTTO"; if ((to === "otf") !== cff) return fail(`This font has ${cff ? "PostScript (CFF)" : "TrueType"} outlines, so it unwraps to ${cff ? "OTF" : "TTF"}.`); return { name: n(to), mime: `font/${to}`, bytes: b }; }
    case "patch": case "diff": if (from !== "diff" && from !== "patch") return fail("Only diffs convert here."); return fail("__copy_diff__");
    case "rtf": return T(n("rtf"), textToRtf(asMd(i, base)), "application/rtf");
    default: {
      if (i.kind === "files" && (to === "txt" || to === "md")) return T(n(to), asMd(i, base), "text/plain");
      if (i.kind === "tree" && to === "txt") return T(n("txt"), (from === "drawio" ? (i.value as any).nodes.map((x: any) => x.label).join("\n") : JSON.stringify(i.value, null, 2)) + "\n", "text/plain");
      return { doc: { title: i.kind === "doc" ? i.title : base, md: asMd(i, base), format: to } };
    }
  }
}

/** Independent re-read of a produced file; returns a problem description or null. */
export function verifyProduced(to: string, bytes: Uint8Array): string | null {
  try {
    if (!bytes.length) return "The output is empty.";
    const s = () => dec(bytes);
    switch (to) {
      case "json": case "geojson": JSON.parse(s()); return null;
      case "jsonl": s().split("\n").filter(Boolean).forEach((l) => JSON.parse(l)); return null;
      case "yaml": YAML.parse(s()); return null;
      case "toml": TOML.parse(s()); return null;
      case "xml": case "kml": case "gpx": safeXml(s()); return null;
      case "srt": case "vtt": case "ass": case "ssa": case "lrc": parseSubs(to, s()); return null;
      case "ods": odsRows(bytes); return null;
      case "zip": case "cbz": unzipSafe(bytes); return null;
      case "tar": readTar(bytes); return null;
      case "tgz": readTar(gunzipSync(bytes)); return null;
      case "rtf": rtfText(s()); return null;
      case "ttf": case "otf": fontInfo(bytes); return null;
      case "sql": sqlInserts(s()); return null;
      case "vcf": parseVcf(s()); return null;
      case "ics": parseIcs(s()); return null;
      default: return null;
    }
  } catch (e) { return `The ${to.toUpperCase()} output failed validation: ${(e as Error).message}`; }
}
