// Chat tool catalogue. Every tool does real work on the server and returns text, data and/or files.
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { strToU8, strFromU8, zipSync } from "fflate";
import * as P from "./pure";
import { writeXlsx, readXlsx, docxText, writeEpub, toXhtml } from "./office";
import { readArchiveSafely } from "@/lib/builder/archive";
import { findSecretKinds } from "../../../security/archive/zip-guard";
import type { Style } from "@/lib/i18n/pdf-text.server";
import { detectLocale, localeById } from "@/lib/i18n/locales";

export type WorkFile = { name: string; mime: string; bytes: Uint8Array };
export type ToolOut = { table?: unknown[][]; text?: string; data?: unknown; files?: WorkFile[]; preview?: { kind: "svg" | "markdown"; content: string } };
export type ToolCtx = { files: WorkFile[]; lastText: string; verbatim?: string; lastTable?: unknown[][]; complete: (system: string, user: string, maxTokens?: number) => Promise<string>; note: (d: string) => Promise<void>; stage?: (stage: "writing_content" | "creating_document" | "converting_file" | "fetching", detail: string) => Promise<void> };
export type Tool = { id: string; category: string; desc: string; params: string; run: (c: ToolCtx, p: any) => Promise<ToolOut> };

const MAX_TEXT = 400_000;
const ext = (n: string) => n.split(".").pop()!.toLowerCase();
const base = (n: string) => n.replace(/\.[^.]+$/, "") || "file";
const kindOf = (f: WorkFile) => {
  const e = ext(f.name), sniff = P.sniffType(f.bytes)?.mime ?? f.mime;
  if (sniff === "application/pdf") return "pdf";
  if (sniff.startsWith("image/") || e === "svg") return "image";
  if (sniff.startsWith("audio/") || /^(mp3|wav|ogg|m4a|flac|aac|opus)$/.test(e)) return "audio";
  if (sniff.startsWith("video/") || /^(mp4|webm|mov|mkv|avi)$/.test(e)) return "video";
  if (e === "docx") return "docx";
  if (/^(xlsx|xlsm)$/.test(e)) return "xlsx";
  if (e === "zip" || e === "epub") return "zip";
  return "text";
};
function pick(c: ToolCtx, p: any, want?: string[]): WorkFile {
  const list = c.files.filter((f) => !want || want.includes(kindOf(f)));
  const f = (p?.file && list.find((x) => x.name === p.file)) || list[list.length - 1];
  if (!f) throw new Error(want ? `This needs a ${want.join(" or ")} file. Attach one in the chat.` : "Attach a file first.");
  return f;
}
const many = (c: ToolCtx, want: string[]) => c.files.filter((f) => want.includes(kindOf(f)));
// CSV with non-ASCII text gets a UTF-8 BOM so Excel opens it as UTF-8 instead of the system code page.
const txt = (name: string, content: string, mime = "text/plain"): WorkFile => ({ name, mime, bytes: strToU8(mime === "text/csv" && /[^\x00-\x7f]/.test(content) && !content.startsWith("\uFEFF") ? "\uFEFF" + content : content) });

/** Plain text of any supported file. */
export async function textOf(f: WorkFile, ctx?: ToolCtx): Promise<string> {
  const k = kindOf(f);
  if (k === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(f.bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const t = String(text).trim();
    if (!t) throw new Error("This PDF has no selectable text (it may be scanned). Ask me to read it as images instead.");
    return t.slice(0, MAX_TEXT);
  }
  if (k === "docx") { try { return docxText(f.bytes).text.slice(0, MAX_TEXT); } catch { throw new Error(`${f.name} is damaged or not a real Word (.docx) file.`); } }
  if (k === "xlsx") return readXlsx(f.bytes, 5000).map((s) => `# ${s.name}\n${P.toCsv(s.rows)}`).join("\n").slice(0, MAX_TEXT);
  if (k === "image") { await ctx?.note(`Reading text in ${f.name}`); const { vision } = await import("./ai.server"); return vision(f.bytes, P.sniffType(f.bytes)?.mime ?? f.mime, "Transcribe all text in this image exactly, keeping line breaks. If there is no text, describe the image briefly."); }
  if (k === "audio") { await ctx?.note(`Transcribing ${f.name}`); const { transcribe } = await import("./ai.server"); return (await transcribe(f.bytes)).text; }
  if (k === "video") throw new Error("Reading video content isn't available on this server (no video processing engine). Extract the audio as MP3 and attach it instead.");
  if (k === "zip") throw new Error("Use ZIP analysis for archives.");
  const s = strFromU8(f.bytes.subarray(0, MAX_TEXT * 2));
  if (/\.html?$/i.test(f.name)) return P.htmlExtract(s).text;
  return s;
}
async function inputText(c: ToolCtx, p: any): Promise<string> {
  if (typeof p?.text === "string" && p.text) return p.text;
  if (c.files.length && (p?.file || !c.lastText)) return textOf(pick(c, p), c);
  if (c.lastText) return c.lastText;
  throw new Error("Give me some text or attach a file.");
}
async function tableOf(c: ToolCtx, p: any): Promise<unknown[][]> {
  if (Array.isArray(p?.rows)) return p.rows;
  if (typeof p?.csv === "string") return P.typedRows(P.parseCsv(p.csv));
  const f = c.files.length ? pick(c, p, ["xlsx", "text"]) : null;
  if (f && kindOf(f) === "xlsx") { const sheets = readXlsx(f.bytes); return (sheets.find((s) => s.name === p?.sheet) ?? sheets[0]).rows; }
  const t = f ? strFromU8(f.bytes) : c.lastText;
  if (!t) throw new Error("Attach a CSV, Excel or JSON file with the data.");
  const trimmed = t.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) { const j = JSON.parse(trimmed); const arr = Array.isArray(j) ? j : Object.values(j).find(Array.isArray) ?? [j]; return P.objectsToRows(arr as any); }
  return P.typedRows(P.parseCsv(t));
}
/** Loads a PDF, turning parser crashes into a clear message. */
async function loadPdf(bytes: Uint8Array, opts?: Parameters<typeof PDFDocument.load>[1]) {
  try { const d = await PDFDocument.load(bytes, opts); d.getPageCount(); d.getPages(); return d; } catch { throw new Error("This PDF is damaged or not a valid PDF, so it can't be opened."); }
}
const clean = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

// ---------- Document builders ----------
const WIN = /[^\x09\x0a\x0d\x20-\x7e\xa0-\xff€‘’“”•–—…]/g;
const PDF_LOST = new WeakMap<Uint8Array, number>();
export async function markdownToPdf(title: string, md: string, fetcher?: typeof fetch): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setProducer("VISION"); doc.setCreator("VISION");
  const { createTextKit } = await import("@/lib/i18n/pdf-text.server");
  const kit = await createTextKit(doc, `${title}\n${md}`, fetcher);
  const W = 595, H = 842, M = 56;
  let page = doc.addPage([W, H]), y = H - M;
  // CJK has no spaces between words: each Han/Kana/Hangul character is its own break opportunity.
  const tokens = (t: string) => t.split(/(\s+)/).flatMap((w) => (/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(w) ? w.split(/(?=[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef])/u) : [w]));
  const line = (t: string, f: Style = "regular", size = 11, indent = 0, gap = 1.45) => {
    let cur = "";
    const flush = () => { if (y < M + size) { page = doc.addPage([W, H]); y = H - M; } kit.draw(page, cur, M + indent, y - size, size, f, W - 2 * M - indent); y -= size * gap; cur = ""; };
    for (const w of tokens(t)) { const next = cur + w; if (kit.width(next, f, size) > W - 2 * M - indent && cur.trim()) { flush(); cur = w.trimStart(); } else cur = next; }
    if (cur.trim() || !t) flush();
  };
  let inCode = false;
  for (const raw of md.split(/\r?\n/)) {
    if (raw.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode) { line(raw || " ", "mono", 9, 8, 1.3); continue; }
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    if (h) { y -= 6; line(plain(h[2]), "bold", [20, 15, 13][h[1].length - 1]); y -= 2; }
    else if (/^\s*[-*]\s+/.test(raw)) { const b = plain(raw.replace(/^\s*[-*]\s+/, "")); line("• " + b, "regular", 11, 12); }
    else if (/^\s*\|/.test(raw)) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(raw)) line(raw.split("|").filter((c, i, a) => i && i < a.length - 1).map((c) => plain(c.trim())).join("   |   "), "regular", 10); }
    else if (!raw.trim()) y -= 6;
    else line(plain(raw));
  }
  const bytes = await doc.save();
  PDF_LOST.set(bytes, kit.lost());
  return bytes;
}
export async function markdownToDocx(title: string, md: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
  // Script-aware fonts: ascii/hAnsi for Latin, eastAsia for CJK, cs (complex script) for Arabic/Indic; RTL paragraphs get bidi.
  const loc = localeById(detectLocale(md) ?? "en") ?? localeById("en")!;
  const cjk = ["zh-CN", "zh-TW", "ja", "ko"].includes(loc.id) ? loc.fonts[0] : "Noto Sans SC";
  const complex = ["ar", "ur", "hi", "bn", "ta"].includes(loc.id) ? loc.fonts[0] : "Noto Naskh Arabic";
  const font = { ascii: "Arial", hAnsi: "Arial", eastAsia: cjk, cs: complex };
  const rtlOf = (s: string) => /^[^A-Za-z\u0900-\u0dff\u3040-\u9fff\uac00-\ud7af]*[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/.test(s);
  const runs = (s: string) => { const rtl = rtlOf(s); return s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => part.startsWith("**") ? new TextRun({ text: part.slice(2, -2), bold: true, font, rightToLeft: rtl }) : new TextRun({ text: part.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"), font, rightToLeft: rtl })); };
  const para = (o: any, text: string) => new Paragraph({ ...o, ...(rtlOf(text) ? { bidirectional: true } : {}) });
  const children: any[] = [];
  let code = false;
  for (const raw of md.split(/\r?\n/)) {
    if (raw.startsWith("```")) { code = !code; continue; }
    if (code) { children.push(new Paragraph({ children: [new TextRun({ text: raw, font: "Courier New", size: 18 })] })); continue; }
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    if (h) children.push(para({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][h[1].length - 1], children: runs(h[2]) }, h[2]));
    else if (/^\s*[-*]\s+/.test(raw)) children.push(para({ bullet: { level: 0 }, children: runs(raw.replace(/^\s*[-*]\s+/, "")) }, raw.replace(/^\s*[-*]\s+/, "")));
    else if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) continue;
    else children.push(para({ children: runs(raw.replace(/^\s*\|/, "").replace(/\|\s*$/, "").replace(/\s*\|\s*/g, "    ")) }, raw));
  }
  const doc = new Document({ title, creator: "VISION", styles: { default: { document: { run: { font, size: 22 } } } }, sections: [{ children }] });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
async function mdToHtml(title: string, md: string) {
  const { marked } = await import("marked");
  const body = await marked.parse(md, { async: true });
  const loc = localeById(detectLocale(md) ?? "en") ?? localeById("en")!;
  const stack = [...new Set([...loc.fonts, "Noto Sans", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", "Noto Naskh Arabic", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Tamil", "Arial", "sans-serif"])].map((f) => (f.includes(" ") ? `'${f}'` : f)).join(",");
  // dir="auto" on blocks lets mixed RTL/LTR paragraphs each take their own direction.
  return `<!doctype html><html lang="${loc.id}" dir="${loc.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, "&lt;")}</title><style>body{font-family:${stack};max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6;color:#1e293b}pre{background:#f1f5f9;padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:6px 10px;text-align:start}pre,code{direction:ltr;unicode-bidi:isolate}</style></head><body>${body.replace(/<(p|h[1-6]|li|td|th)>/g, '<$1 dir="auto">')}</body></html>`;
}
const mdTables = (md: string): unknown[][] => {
  const rows = md.split(/\r?\n/).filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  return rows.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
};
/** Characters the built-in PDF fonts cannot draw (they are written as "?"). */
export function pdfLostChars(pdf: Uint8Array): number { return PDF_LOST.get(pdf) ?? 0; }
const pdfNote = (fmt: string, file: WorkFile) => { const n = fmt === "pdf" ? pdfLostChars(file.bytes) : 0; return n ? ` ⚠️ ${n} character(s) (for example emoji, or a script whose font couldn't be loaded) can't be drawn in the PDF and appear as "?". Choose DOCX, HTML or TXT to keep them.` : ""; };
export async function buildDocument(format: string, title: string, md: string): Promise<WorkFile> {
  const n = P.slugify(title).slice(0, 60) || "document";
  switch (format) {
    case "pdf": return { name: `${n}.pdf`, mime: "application/pdf", bytes: await markdownToPdf(title, md) };
    case "docx": case "word": return { name: `${n}.docx`, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: await markdownToDocx(title, md) };
    case "html": return txt(`${n}.html`, await mdToHtml(title, md), "text/html");
    case "txt": return txt(`${n}.txt`, md.replace(/^#+\s*/gm, "").replace(/\*\*/g, ""));
    case "epub": { const { marked } = await import("marked"); const parts = md.split(/^(?=# )/m).filter((s) => s.trim()); const chapters = await Promise.all((parts.length ? parts : [md]).map(async (s) => ({ title: s.match(/^#\s+(.*)/)?.[1] ?? title, html: toXhtml(await marked.parse(s.replace(/^#\s+.*\n?/, ""), { async: true })) }))); return { name: `${n}.epub`, mime: "application/epub+zip", bytes: writeEpub(title, "VISION", chapters) }; }
    case "xlsx": case "excel": { const rows = mdTables(md); if (!rows.length) throw new Error("No table found to put in a spreadsheet."); return { name: `${n}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: writeXlsx([{ name: title.slice(0, 31), rows }]) }; }
    case "csv": { const rows = mdTables(md); if (!rows.length) throw new Error("No table found for CSV."); return txt(`${n}.csv`, P.toCsv(rows), "text/csv"); }
    default: return txt(`${n}.md`, md, "text/markdown");
  }
}

async function sha(algo: string, bytes: Uint8Array) {
  const a = ({ sha1: "SHA-1", "sha-1": "SHA-1", sha256: "SHA-256", "sha-256": "SHA-256", sha384: "SHA-384", sha512: "SHA-512", "sha-512": "SHA-512" } as any)[algo.toLowerCase()] ?? "SHA-256";
  const d = new Uint8Array(await crypto.subtle.digest(a, bytes as Uint8Array<ArrayBuffer>));
  return { algorithm: a, hex: Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("") };
}

// ---------- Catalogue ----------
/** Shared tail of the three repository analyzers: each provider fetches on its own; the model only sees what was retrieved. */
async function repoTool(c: ToolCtx, p: any, fetchRepo: () => Promise<import("@/lib/repos/common").RepoSnapshot>) {
  const { snapshotText, inspectedList } = await import("@/lib/repos/common");
  await c.stage?.("fetching", "Fetching the public repository");
  await c.note("Fetching the public repository");
  const s = await fetchRepo();
  await c.note(`Read ${s.fullName}: ${s.tree.length} files listed, ${s.files.length + (s.readme ? 1 : 0)} opened`);
  const q = String(p?.question ?? "").trim() || "Summarize the architecture, main technologies and dependencies, important implementation details and any potential issues.";
  const answer = await c.complete("You analyze a source repository using ONLY the retrieved material. Cite file paths. Never claim to have read a file that is not included; say what is unknown. Separate observations from inferences.", `${snapshotText(s)}\n\nQuestion: ${q}`, 3000);
  const text = `## ${s.fullName}\n${s.url}\n\n${answer.trim()}\n\n_Inspected: ${inspectedList(s)}${s.treeTruncated ? " · file tree truncated" : ""}${s.missing.length ? ` · could not read: ${s.missing.join(", ")}` : ""}._`;
  return { text, data: { repo: s.fullName, url: s.url, branch: s.defaultBranch, files: s.tree.length, inspected: [...(s.readme ? ["README"] : []), ...s.files.map((f) => f.path)] } };
}

export const TOOLS: Tool[] = [
  // Files & metadata
  { id: "file_info", category: "Metadata", desc: "Inspect attached files: real type, size, SHA-256, image size, PDF pages/metadata, Word properties, sheet sizes", params: "{}", run: async (c) => {
    if (!c.files.length) throw new Error("Attach a file to inspect.");
    const out: any[] = [];
    for (const f of c.files) {
      const info: any = { name: f.name, size: P.fmtBytes(f.bytes.length), detectedType: P.sniffType(f.bytes)?.mime ?? (f.mime || "unknown"), sha256: (await sha("sha256", f.bytes)).hex };
      const k = kindOf(f);
      if (k === "image") info.dimensions = P.imageSize(f.bytes);
      if (k === "pdf") { const d = await loadPdf(f.bytes, { ignoreEncryption: true, updateMetadata: false }); try { Object.assign(info, { pages: d.getPageCount(), title: d.getTitle(), author: d.getAuthor(), producer: d.getProducer(), created: d.getCreationDate()?.toISOString() }); } catch { info.problem = "The PDF structure is damaged; pages and metadata can't be read."; } }
      if (k === "docx") { const d = docxText(f.bytes); Object.assign(info, { title: d.title, author: d.author, words: P.textStats(d.text).words }); }
      if (k === "xlsx") info.sheets = readXlsx(f.bytes, 100000).map((s) => ({ name: s.name, rows: s.rows.length, columns: Math.max(0, ...s.rows.map((r) => r.length)) }));
      if (k === "text") Object.assign(info, P.textStats(strFromU8(f.bytes.subarray(0, 2_000_000))));
      out.push(info);
    }
    return { data: out, text: out.map((i) => Object.entries(i).filter(([, v]) => v != null && v !== "").map(([k, v]) => `- **${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")).join("\n\n") };
  } },
  { id: "extract_text", category: "Content extraction & OCR", desc: "Extract text from attached files: PDF, Word, Excel, HTML, text; OCR for images; speech-to-text for audio. Processes every attached file", params: '{"save_as"?: "txt"|"md"}', run: async (c, p) => {
    if (!c.files.length) throw new Error("Attach a file to extract text from.");
    const parts: string[] = [];
    for (const f of c.files) parts.push(`${c.files.length > 1 ? `## ${f.name}\n\n` : ""}${await textOf(f, c)}`);
    const all = parts.join("\n\n");
    return { text: all, files: [txt(`${base(c.files[0].name)}-text.${p?.save_as === "md" ? "md" : "txt"}`, all)] };
  } },
  { id: "ocr", category: "Content extraction & OCR", desc: "Read text from images (photos, screenshots, scans) with the vision model", params: '{"instructions"?: string}', run: async (c, p) => {
    const imgs = many(c, ["image"]); if (!imgs.length) throw new Error("Attach an image to read.");
    const { vision } = await import("./ai.server");
    const parts: string[] = [];
    for (const f of imgs) { await c.note(`Reading ${f.name}`); parts.push(`${imgs.length > 1 ? `## ${f.name}\n\n` : ""}${await vision(f.bytes, P.sniffType(f.bytes)?.mime ?? f.mime, p?.instructions || "Transcribe all text in this image exactly, keeping line breaks and table layout. Output only the text.")}`); }
    const t = parts.join("\n\n"); return { text: t, files: [txt(`${base(imgs[0].name)}-ocr.txt`, t)] };
  } },
  { id: "describe_image", category: "Image processing", desc: "Describe or answer a question about an attached image (objects, charts, UI, scene)", params: '{"question"?: string}', run: async (c, p) => {
    const f = pick(c, p, ["image"]); const { vision } = await import("./ai.server");
    return { text: await vision(f.bytes, P.sniffType(f.bytes)?.mime ?? f.mime, p?.question || "Describe this image in detail.") };
  } },
  { id: "transcribe_audio", category: "Audio processing", desc: "Transcribe speech in an attached audio file; also returns WebVTT subtitles", params: "{}", run: async (c, p) => {
    const f = pick(c, p, ["audio"]); const { transcribe } = await import("./ai.server");
    await c.note(`Transcribing ${f.name}`); const r = await transcribe(f.bytes);
    if (!r.text) throw new Error("No speech was found in this audio.");
    return { text: r.text, data: { words: r.words }, files: [txt(`${base(f.name)}.txt`, r.text), txt(`${base(f.name)}.vtt`, r.vtt, "text/vtt")] };
  } },
  // Documents & PDF
  { id: "create_document", category: "File creation", desc: "Write a new document with AI (report, letter, resume, essay, notes, table…) and save it as pdf, docx, html, md, txt, epub, xlsx or csv. Uses the previous step's text as source when present", params: '{"request": string, "format": "pdf"|"docx"|"html"|"md"|"txt"|"epub"|"xlsx"|"csv", "title"?: string, "use_previous"?: boolean, "verbatim"?: boolean (true = save the previous step text unchanged)}', run: async (c, p) => {
    const fmt = String(p?.format || "md").toLowerCase();
    if (p?.verbatim && c.lastText && !/xlsx|csv|excel/.test(fmt)) {
      const title = p?.title || c.lastText.match(/^#\s+(.*)/m)?.[1] || "Document";
      await c.stage?.("creating_document", `Creating ${fmt.toUpperCase()}`);
      const file = await buildDocument(fmt, title, c.lastText);
      return { text: `Saved the previous result as ${fmt.toUpperCase()}.${pdfNote(fmt, file)}`, files: [file] };
    }
    if (/xlsx|csv|excel/.test(fmt) && (c.lastTable || c.files.some((f) => /\.(csv|tsv|json)$/i.test(f.name) || kindOf(f) === "xlsx"))) {
      // Real data is available: write it as-is instead of letting the AI retype (and possibly invent) numbers.
      const rows = c.lastTable ?? await tableOf(c, {});
      const title = p?.title || "data";
      await c.stage?.("creating_document", `Creating ${fmt.toUpperCase()}`);
      const file = fmt === "csv" ? txt(`${P.slugify(title) || "data"}.csv`, P.toCsv(rows), "text/csv") : { name: `${P.slugify(title) || "data"}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: writeXlsx([{ name: title.slice(0, 31), rows }]) };
      return { text: `Saved ${rows.length - 1} data rows to ${file.name}.`, files: [file], table: rows };
    }
    const src = p?.use_previous !== false && c.lastText ? `\n\nSource material:\n${c.lastText.slice(0, 30000)}` : "";
    const ready = p?.use_previous !== false && c.verbatim?.trim() ? c.verbatim.trim() : "";
    if (!ready) await c.stage?.("writing_content", "Writing document content");
    const md = ready || clean(await c.complete(`You write complete, polished documents in Markdown. Use # headings, lists and Markdown tables where useful.${/xlsx|csv|excel/.test(fmt) ? " The document MUST be a single Markdown table with a header row containing all data." : ""} Output only the document.`, `${p?.request || "Write the document."}${src}`, 6000));
    if (!md) throw new Error("The writer returned nothing.");
    const title = p?.title || md.match(/^#\s+(.*)/m)?.[1] || "Document";
    await c.stage?.("creating_document", `Creating ${fmt.toUpperCase()}`);
    const file = await buildDocument(fmt, title, md);
    return { text: md.slice(0, 20000) + pdfNote(fmt, file), files: [file], preview: { kind: "markdown", content: md.slice(0, 20000) } };
  } },
  { id: "convert_document", category: "File conversion", desc: "Convert a document between formats keeping its text: PDF/Word/HTML/Markdown/text/Excel/CSV → pdf, docx, html, md, txt, epub; images → pdf", params: '{"to": "pdf"|"docx"|"html"|"md"|"txt"|"epub"|"xlsx"|"csv", "file"?: string}', run: async (c, p) => {
    const to = String(p?.to || "").toLowerCase().replace("word", "docx");
    if (!to) throw new Error("Which format should I convert to?");
    await c.stage?.("converting_file", `Converting to ${to.toUpperCase()}`);
    const imgs = many(c, ["image"]).filter((f) => /png|jpe?g/.test(P.sniffType(f.bytes)?.ext ?? ""));
    if (to === "pdf" && imgs.length && imgs.length === c.files.length) {
      const doc = await PDFDocument.create();
      for (const f of imgs) { const img = P.sniffType(f.bytes)!.ext === "png" ? await doc.embedPng(f.bytes) : await doc.embedJpg(f.bytes); const pg = doc.addPage([img.width, img.height]); pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height }); }
      return { text: `Combined ${imgs.length} image(s) into one PDF.`, files: [{ name: `${base(imgs[0].name)}.pdf`, mime: "application/pdf", bytes: await doc.save() }] };
    }
    const f = pick(c, p);
    if (["xlsx", "csv", "json"].includes(to)) {
      const tabular = kindOf(f) === "xlsx" || /\.(csv|tsv|json)$/i.test(f.name);
      // Prose documents only convert when they contain a real table; never split paragraphs into fake rows.
      const rows = tabular ? await tableOf(c, p) : mdTables(/\.html?$/i.test(f.name) ? "" : await textOf(f, c));
      if (!tabular && rows.length < 2) throw new Error(`${f.name} has no table I can turn into ${to.toUpperCase()}. Only CSV, Excel, JSON or documents containing a Markdown table can be converted to data formats.`);
      if (to === "xlsx") return { text: `Converted ${rows.length} rows to Excel.`, files: [{ name: `${base(f.name)}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: writeXlsx([{ name: base(f.name), rows }]) }] };
      if (to === "csv") return { text: `Converted ${rows.length} rows to CSV.`, files: [txt(`${base(f.name)}.csv`, P.toCsv(rows), "text/csv")] };
      const j = JSON.stringify(P.rowsToObjects(rows.map((r) => r.map((v) => String(v ?? "")))), null, 2); return { text: j.slice(0, 4000), files: [txt(`${base(f.name)}.json`, j, "application/json")] };
    }
    let md = await textOf(f, c);
    if (/\.html?$/i.test(f.name)) { const h = P.htmlExtract(strFromU8(f.bytes)); md = [h.title ? `# ${h.title}` : "", h.text].join("\n\n"); }
    if (kindOf(f) === "xlsx" || /\.csv$/i.test(f.name)) { const rows = await tableOf(c, p); md = [rows[0], rows[0].map(() => "---"), ...rows.slice(1)].map((r) => `| ${r.join(" | ")} |`).join("\n"); }
    const out = await buildDocument(to, base(f.name), md);
    out.name = `${base(f.name)}.${out.name.split(".").pop()}`;
    const warn = kindOf(f) === "pdf" ? " Layout, images and fonts from the PDF are not kept — only the text." : "";
    return { text: `Converted **${f.name}** to ${to.toUpperCase()}.${warn}${pdfNote(to, out)}`, files: [out] };
  } },
  { id: "convert_format", category: "File conversion", desc: "Convert ANY attached file between compatible formats using the format registry: data (CSV, TSV, JSON, JSONL, XML, YAML, TOML, SQL inserts, XLSX, ODS), config (INI, CFG, CONF, ENV, PROPERTIES), subtitles (SRT, VTT, ASS, SSA, LRC), contacts/calendars (VCF, ICS), maps (GPX, KML, GeoJSON), notebooks (IPYNB → py/md/html/pdf), code/logs/diffs → txt/md/html/pdf/docx/csv, RTF/ODT/PPTX/ODP/FB2/TeX/EPUB text, archives (ZIP, TAR, GZ, TGZ repack), comic CBZ → PDF, WOFF → TTF/OTF, draw.io → DOT/Mermaid/JSON. Media, office-native, database, e-book, font and diagram rendering conversions run as background tasks automatically", params: '{"to": string (target extension), "file"?: string}', run: async (c, p) => {
    const { formatOfName, routeConversion, canonicalId, matchesSignature, hasSignature, FORMAT_BY_ID } = await import("@/lib/formats/inventory");
    const F = await import("@/lib/formats/convert");
    if (!c.files.length) throw new Error("Attach the file to convert.");
    const f = (p?.file && c.files.find((x) => x.name === p.file)) || c.files[c.files.length - 1];
    const fmt = formatOfName(f.name); if (!fmt) throw new Error(`I don't recognise the format of ${f.name}.`);
    if (hasSignature(fmt.id) && !matchesSignature(fmt.id, f.bytes)) throw new Error(`${f.name} is named .${ext(f.name)} but its content is not a real ${fmt.name} file.`);
    const to = canonicalId(String(p?.to ?? "")) ?? String(p?.to ?? "").toLowerCase();
    const r = routeConversion(fmt.id, to);
    if (r.where === "unsupported") throw new Error(r.reason);
    if (r.where === "runtime") throw new Error(`${fmt.name} → ${to.toUpperCase()} runs as a background task: send the file again with "convert to ${to}" and it starts automatically.`);
    const nm = P.slugify(base(f.name)) || "converted";
    let out: WorkFile;
    if (fmt.id === "cbz" && to === "pdf") {
      const pages = ((F.read("cbz", f.name, f.bytes) as any).files as { path: string; bytes: Uint8Array }[]).filter((x) => /\.(jpe?g|png)$/i.test(x.path)).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
      if (!pages.length) throw new Error("The comic has no JPEG/PNG pages.");
      const doc = await PDFDocument.create();
      for (const pg of pages) { const png = P.sniffType(pg.bytes)?.ext === "png"; const im = png ? await doc.embedPng(pg.bytes) : await doc.embedJpg(pg.bytes); doc.addPage([im.width, im.height]).drawImage(im, { x: 0, y: 0, width: im.width, height: im.height }); }
      out = { name: `${nm}.pdf`, mime: "application/pdf", bytes: await doc.save() };
    } else if (fmt.id === "ipynb" && to === "py") {
      out = txt(`${nm}.py`, F.notebookMd(strFromU8(f.bytes)).py, "text/x-python");
    } else if ((fmt.id === "diff" || fmt.id === "patch") && (to === "diff" || to === "patch")) {
      F.parseDiff(strFromU8(f.bytes)); out = { name: `${nm}.${to}`, mime: "text/x-diff", bytes: f.bytes };
    } else if (fmt.category === "code" || fmt.id === "dockerfile" || fmt.id === "gitignore" || ((fmt.id === "mmd" || fmt.id === "puml" || fmt.id === "dot") && to !== "json")) {
      const src = strFromU8(f.bytes);
      if (to === "json") { const lines = src.split(/\r?\n/); out = txt(`${nm}.json`, JSON.stringify(fmt.id === "dockerfile" ? lines.filter((l) => /^\s*[A-Z]+\s/.test(l)).map((l) => ({ instruction: l.trim().split(/\s+/)[0], args: l.trim().split(/\s+/).slice(1).join(" ") })) : fmt.id === "gitignore" ? lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((pattern) => ({ pattern, negated: pattern.startsWith("!") })) : { lines: lines.length, text: src }, null, 2), "application/json"); }
      else if (to === "txt") out = txt(`${nm}.txt`, src);
      else { const md = `# ${f.name}\n\n\`\`\`${fmt.id}\n${src.replace(/\`\`\`/g, "ʼʼʼ")}\n\`\`\``; out = await buildDocument(to, f.name, md); out.name = `${nm}.${ext(out.name)}`; }
    } else if (["pdf", "docx", "html", "md", "txt", "epub"].includes(fmt.id) && !(fmt.id === "html" && (to === "csv" || to === "xlsx"))) {
      const md = fmt.id === "md" || fmt.id === "txt" ? strFromU8(f.bytes) : await textOf(f, c);
      if (to === "rtf") out = txt(`${nm}.rtf`, F.textToRtf(md), "application/rtf"); else { out = await buildDocument(to, base(f.name), md); out.name = `${nm}.${ext(out.name)}`; }
    } else {
      const inter = fmt.id === "html" ? { kind: "table" as const, rows: F.htmlTables(strFromU8(f.bytes)) } : F.read(fmt.id, f.name, f.bytes);
      const w = F.write(to, inter, nm, fmt.id);
      if ("doc" in w) { out = await buildDocument(w.doc.format, w.doc.title, w.doc.md); out.name = `${nm}.${ext(out.name)}`; }
      else out = { name: w.name, mime: w.mime, bytes: w.bytes };
    }
    const bad = F.verifyProduced(to, out.bytes); if (bad) throw new Error(bad);
    const lossy = FORMAT_BY_ID.get(fmt.id)?.notes;
    return { text: `Converted **${f.name}** (${fmt.name}) to **${out.name}**.${lossy && /dropped|lost|only|not kept|inferred/i.test(lossy) ? ` Note: ${lossy}` : ""}`, files: [out] };
  } },
  { id: "format_support", category: "Metadata", desc: "Answer what VISION can do with a file format (read, create, convert targets, where it runs) or inspect an attached file's format details (fonts, SVG, DXF, archives, notebooks, subtitles, calendars, contacts, maps, diffs, logs, .env secrets warning)", params: '{"format"?: string}', run: async (c, p) => {
    const I = await import("@/lib/formats/inventory"); const F = await import("@/lib/formats/convert");
    if (p?.format && !c.files.length) { const id = I.canonicalId(String(p.format)); const x = id && I.FORMAT_BY_ID.get(id); if (!x) throw new Error(`"${p.format}" is not in VISION's format registry.`); return { text: I.capabilitySummary(x), data: x }; }
    const f = c.files[c.files.length - 1]; if (!f) throw new Error("Attach a file or name a format.");
    const x = I.formatOfName(f.name); if (!x) throw new Error(`I don't recognise the format of ${f.name}.`);
    const real = !I.hasSignature(x.id) || I.matchesSignature(x.id, f.bytes);
    const s = () => strFromU8(f.bytes.subarray(0, 4_000_000));
    let details: unknown = null;
    try {
      if (x.category === "font") details = F.fontInfo(f.bytes);
      else if (x.id === "svg") details = F.svgInfo(s());
      else if (x.id === "dxf") details = F.dxfInfo(s());
      else if (x.id === "drawio") { const g = F.parseDrawio(s()); details = { shapes: g.nodes.length, connectors: g.edges.length }; }
      else if (x.id === "ipynb") details = { cells: F.notebookMd(s()).cells };
      else if (x.id === "env") { const v = F.parseProps(s()); details = { keys: Object.keys(v).length, secretLooking: Object.keys(v).filter((k) => F.SECRETISH.test(k)) }; }
      else if (x.id === "diff" || x.id === "patch") details = F.parseDiff(s());
      else if (x.category === "archive" && x.inline.length) { const r = F.read(x.id, f.name, f.bytes) as any; details = { entries: r.files.length, files: r.files.slice(0, 200).map((e: any) => `${e.path} (${P.fmtBytes(e.bytes.length)})`) }; }
      else if (x.inline.length && x.read && !["pdf", "docx", "xlsx", "html", "md", "txt", "epub"].includes(x.id) && x.category !== "code") { const r: any = F.read(x.id, f.name, f.bytes); details = r.kind === "table" ? { rows: r.rows.length - 1, columns: r.rows[0]?.length } : r.kind === "cues" ? { cues: r.cues.length, duration_s: Math.round(r.cues[r.cues.length - 1].end / 1000) } : r.kind === "geo" ? { features: r.features.length } : r.kind === "tree" ? { records: Array.isArray(r.value) ? r.value.length : Object.keys(r.value ?? {}).length } : { characters: r.md?.length }; }
    } catch (e: any) { details = { problem: e?.message ?? "unreadable" }; }
    const info = { file: f.name, format: x.name, size: P.fmtBytes(f.bytes.length), contentMatchesExtension: real, ...(details ? { details } : {}), capabilities: I.capabilitySummary(x) };
    return { data: info, text: Object.entries(info).map(([k, v]) => `- **${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n") };
  } },
  { id: "pdf_merge", category: "PDF processing", desc: "Merge all attached PDFs (in order) into one", params: "{}", run: async (c) => {
    const pdfs = many(c, ["pdf"]); if (pdfs.length < 2) throw new Error("Attach at least two PDFs to merge.");
    const out = await PDFDocument.create();
    for (const f of pdfs) { const d = await loadPdf(f.bytes); (await out.copyPages(d, d.getPageIndices())).forEach((pg) => out.addPage(pg)); }
    return { text: `Merged ${pdfs.length} PDFs into ${out.getPageCount()} pages.`, files: [{ name: "merged.pdf", mime: "application/pdf", bytes: await out.save() }] };
  } },
  { id: "pdf_pages", category: "PDF processing", desc: "Split, extract, delete or rotate PDF pages. pages like '1-3,5'", params: '{"action": "extract"|"split_each"|"delete"|"rotate", "pages"?: string, "angle"?: 90|180|270}', run: async (c, p) => {
    const f = pick(c, p, ["pdf"]); const src = await loadPdf(f.bytes); const n = src.getPageCount();
    const sel = parsePages(p?.pages, n);
    if (p?.action === "rotate") { for (const i of sel) src.getPage(i).setRotation(degrees(((src.getPage(i).getRotation().angle + (Number(p.angle) || 90)) % 360))); return { text: `Rotated ${sel.length} page(s).`, files: [{ name: `${base(f.name)}-rotated.pdf`, mime: "application/pdf", bytes: await src.save() }] }; }
    if (p?.action === "split_each") {
      const z: Record<string, Uint8Array> = {};
      for (const i of sel) { const d = await PDFDocument.create(); d.addPage((await d.copyPages(src, [i]))[0]); z[`${base(f.name)}-page-${i + 1}.pdf`] = await d.save(); }
      return { text: `Split into ${sel.length} single-page PDFs.`, files: [{ name: `${base(f.name)}-pages.zip`, mime: "application/zip", bytes: zipSync(z) }] };
    }
    const keep = p?.action === "delete" ? src.getPageIndices().filter((i) => !sel.includes(i)) : sel;
    if (!keep.length) throw new Error("That would leave no pages.");
    const d = await PDFDocument.create(); (await d.copyPages(src, keep)).forEach((pg) => d.addPage(pg));
    return { text: `New PDF has ${keep.length} of ${n} pages.`, files: [{ name: `${base(f.name)}-${p?.action === "delete" ? "trimmed" : "extract"}.pdf`, mime: "application/pdf", bytes: await d.save() }] };
  } },
  { id: "pdf_watermark", category: "PDF processing", desc: "Stamp text (e.g. CONFIDENTIAL) or page numbers onto every page of a PDF", params: '{"text"?: string, "page_numbers"?: boolean}', run: async (c, p) => {
    const f = pick(c, p, ["pdf"]); const d = await loadPdf(f.bytes); const font = await d.embedFont(StandardFonts.HelveticaBold);
    d.getPages().forEach((pg, i) => { const { width, height } = pg.getSize();
      if (p?.text) pg.drawText(String(p.text).replace(WIN, "?").slice(0, 60), { x: width * 0.18, y: height * 0.45, size: Math.min(64, width / 9), font, color: rgb(0.8, 0.1, 0.1), opacity: 0.25, rotate: degrees(35) });
      if (p?.page_numbers) pg.drawText(`${i + 1} / ${d.getPageCount()}`, { x: width / 2 - 14, y: 20, size: 10, font, color: rgb(0.3, 0.3, 0.3) }); });
    return { text: "Stamped every page.", files: [{ name: `${base(f.name)}-stamped.pdf`, mime: "application/pdf", bytes: await d.save() }] };
  } },
  { id: "pdf_metadata", category: "Metadata", desc: "Set or remove PDF metadata (title, author, subject, keywords); 'strip' clears all", params: '{"title"?: string, "author"?: string, "subject"?: string, "keywords"?: string, "strip"?: boolean}', run: async (c, p) => {
    const f = pick(c, p, ["pdf"]); const d = await loadPdf(f.bytes, { updateMetadata: false });
    if (p?.strip) { d.setTitle(""); d.setAuthor(""); d.setSubject(""); d.setKeywords([]); d.setProducer(""); d.setCreator(""); }
    if (p?.title) d.setTitle(p.title); if (p?.author) d.setAuthor(p.author); if (p?.subject) d.setSubject(p.subject); if (p?.keywords) d.setKeywords(String(p.keywords).split(/,\s*/));
    return { text: p?.strip ? "Removed the PDF's metadata." : "Updated the PDF's metadata.", files: [{ name: `${base(f.name)}.pdf`, mime: "application/pdf", bytes: await d.save() }] };
  } },
  // Text & language
  { id: "summarize", category: "Text & language", desc: "Summarize text or attached documents (key points, length, audience)", params: '{"style"?: string}', run: async (c, p) => { const t = await inputText(c, p); await c.stage?.("writing_content", "Writing summary"); const s = clean(await c.complete("You summarize faithfully. Use Markdown with a short overview and key bullet points. Never invent facts.", `${p?.style ? `Style: ${p.style}\n` : ""}Text:\n${t.slice(0, 60000)}`, 2000)); return { text: s, preview: { kind: "markdown", content: s } }; } },
  { id: "translate", category: "Text & language", desc: "Translate text or a document's text into another language", params: '{"to": string}', run: async (c, p) => { const t = await inputText(c, p); await c.stage?.("writing_content", "Writing translation"); const s = clean(await c.complete(`Translate the user's text into ${p?.to || "English"}. Keep formatting. Output only the translation.`, t.slice(0, 40000), 6000)); return { text: s, files: [txt(`translation-${P.slugify(p?.to || "en")}.txt`, s)] }; } },
  { id: "rewrite", category: "Text & language", desc: "Rewrite, proofread, change tone, simplify or expand text", params: '{"instruction": string}', run: async (c, p) => { const t = await inputText(c, p); await c.stage?.("writing_content", "Rewriting text"); return { text: clean(await c.complete(`Rewrite the user's text: ${p?.instruction || "fix grammar and improve clarity"}. Output only the result.`, t.slice(0, 40000), 6000)) }; } },
  { id: "analyze_text", category: "Local AI & ML", desc: "AI analysis of text: sentiment, classification, keyword/entity extraction, Q&A about a document", params: '{"task": string}', run: async (c, p) => { const t = await inputText(c, p); const s = clean(await c.complete("You analyze text precisely. Base every statement on the text; say when the text doesn't contain the answer. Use Markdown.", `Task: ${p?.task || "Analyze sentiment, topics and key entities."}\n\nText:\n${t.slice(0, 60000)}`, 2500)); return { text: s, preview: { kind: "markdown", content: s } }; } },
  { id: "text_stats", category: "Text & language", desc: "Count words, characters, sentences, lines, reading time", params: '{"text"?: string}', run: async (c, p) => { const s = P.textStats(await inputText(c, p)); return { data: s, text: Object.entries(s).map(([k, v]) => `- ${k}: ${v}`).join("\n") }; } },
  { id: "change_case", category: "Text & language", desc: "Change text case: upper, lower, title, sentence, camel, pascal, snake, kebab, constant, slug", params: '{"mode": string, "text"?: string}', run: async (c, p) => ({ text: P.changeCase(await inputText(c, p), p?.mode || "title") }) },
  { id: "find_replace", category: "Text & language", desc: "Find (and optionally replace) text or a regular expression in text/file; lists matching lines", params: '{"find": string, "replace"?: string, "regex"?: boolean, "ignore_case"?: boolean}', run: async (c, p) => {
    const t = await inputText(c, p); if (!p?.find) throw new Error("What should I search for?");
    const re = new RegExp(p.regex ? p.find : p.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), p.ignore_case ? "gi" : "g");
    const hits = t.split(/\r?\n/).map((l, i) => ({ line: i + 1, text: l })).filter((l) => { re.lastIndex = 0; return re.test(l.text); });
    if (typeof p.replace === "string") { const out = t.replace(re, p.replace); return { text: `Replaced matches on ${hits.length} line(s).`, files: [txt(c.files[0] ? c.files[0].name : "replaced.txt", out)] }; }
    return { data: hits.slice(0, 500), text: hits.length ? `${hits.length} matching line(s):\n\n${hits.slice(0, 50).map((h) => `- line ${h.line}: ${h.text.slice(0, 200)}`).join("\n")}` : "No matches." };
  } },
  { id: "compare_text", category: "Data validation & integrity", desc: "Compare two attached files (or two texts) line by line and show the differences", params: '{"a"?: string, "b"?: string}', run: async (c, p) => {
    let a = p?.a, b = p?.b;
    if (!a || !b) { if (c.files.length < 2) throw new Error("Attach two files (or give two texts) to compare."); a = await textOf(c.files[c.files.length - 2], c); b = await textOf(c.files[c.files.length - 1], c); }
    const d = P.diffLines(a, b); const body = d.lines.join("\n");
    return { text: `${d.added} line(s) added, ${d.removed} removed.\n\n\`\`\`diff\n${body.slice(0, 6000)}\n\`\`\``, files: [txt("differences.diff", body)] };
  } },
  // Math & science
  { id: "calculate", category: "Math & science", desc: "Evaluate math expressions exactly (+-*/^%, !, sqrt, sin, log, ln, pi, e…)", params: '{"expression": string}', run: async (_c, p) => { const v = P.evaluate(String(p?.expression ?? "")); return { data: { result: v }, text: `${p.expression} = **${+v.toPrecision(15)}**` }; } },
  { id: "convert_units", category: "Math & science", desc: "Convert units: length, mass, volume, time, data, speed, area, temperature", params: '{"value": number, "from": string, "to": string}', run: async (_c, p) => { const v = P.convertUnit(Number(p?.value), String(p?.from), String(p?.to)); return { data: { result: v }, text: `${p.value} ${p.from} = **${+v.toPrecision(10)} ${p.to}**` }; } },
  { id: "statistics", category: "Math & science", desc: "Statistics (count, sum, mean, median, min, max, std dev) of a list of numbers", params: '{"numbers": number[]}', run: async (_c, p) => { const s = P.stats((p?.numbers ?? []).map(Number)); if (!s) throw new Error("Give me some numbers."); return { data: s, text: Object.entries(s).map(([k, v]) => `- ${k}: ${+v.toPrecision(10)}`).join("\n") }; } },
  // Data & spreadsheets
  { id: "analyze_data", category: "Spreadsheet & data analysis", desc: "Profile a CSV/Excel/JSON table: rows, column types, empties, duplicates, numeric stats, top values", params: '{"sheet"?: string}', run: async (c, p) => {
    const rows = await tableOf(c, p); if (rows.length < 2) throw new Error("The table has no data rows.");
    const prof = P.profileTable(rows);
    const lines = prof.columns.map((col: any) => `| ${col.name} | ${col.type} | ${col.filled} | ${col.empty} | ${col.unique} | ${col.stats ? `mean ${+col.stats.mean.toPrecision(6)}, min ${col.stats.min}, max ${col.stats.max}` : col.top.slice(0, 3).map((t: any) => `${t.value} (${t.count})`).join(", ")} |`);
    const md = `**${prof.rows} rows, ${prof.columns.length} columns, ${prof.duplicateRows} duplicate rows**\n\n| Column | Type | Filled | Empty | Unique | Summary |\n|---|---|---|---|---|---|\n${lines.join("\n")}`;
    return { data: prof, text: md, preview: { kind: "markdown", content: md }, files: [txt("data-profile.json", JSON.stringify(prof, null, 2), "application/json")] };
  } },
  { id: "query_data", category: "Database & data management", desc: "Filter, sort, group and aggregate a table (like SQL). where ops: = != > < >= <= contains", params: '{"where"?: [{"column": string, "op": string, "value": any}], "group_by"?: string, "aggregate"?: {"column": string, "fn": "sum"|"avg"|"count"|"min"|"max"}, "sort_by"?: string, "desc"?: boolean, "limit"?: number, "format"?: "csv"|"xlsx"|"json"}', run: async (c, p) => {
    const rows = await tableOf(c, p); const head = rows[0].map(String); let body = rows.slice(1);
    const col = (n: string) => { const i = head.findIndex((h) => h.toLowerCase() === String(n).toLowerCase()); if (i < 0) throw new Error(`No column "${n}". Columns: ${head.join(", ")}`); return i; };
    const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v).replace(/,/g, "")));
    for (const w of p?.where ?? []) { const i = col(w.column); body = body.filter((r) => { const v = r[i], x = w.value; switch (w.op) { case "!=": return String(v) != String(x); case ">": return num(v) > num(x); case "<": return num(v) < num(x); case ">=": return num(v) >= num(x); case "<=": return num(v) <= num(x); case "contains": return String(v).toLowerCase().includes(String(x).toLowerCase()); default: return String(v) == String(x); } }); }
    let out: unknown[][] = [head, ...body];
    if (p?.group_by) {
      const gi = col(p.group_by), fn = p.aggregate?.fn ?? "count", ai = p.aggregate?.column ? col(p.aggregate.column) : -1;
      const g = new Map<string, number[]>(); for (const r of body) { const k = String(r[gi]); if (!g.has(k)) g.set(k, []); g.get(k)!.push(ai >= 0 ? num(r[ai]) : 1); }
      const agg = (v: number[]) => { const s = P.stats(v); return fn === "count" ? v.length : !s ? 0 : fn === "sum" ? s.sum : fn === "avg" ? s.mean : fn === "min" ? s.min : s.max; };
      out = [[head[gi], `${fn}${ai >= 0 ? `(${head[ai]})` : ""}`], ...[...g].map(([k, v]) => [k, +agg(v).toPrecision(12)])];
    }
    if (p?.sort_by) { const si = out[0].map(String).findIndex((h) => h.toLowerCase() === String(p.sort_by).toLowerCase()); if (si >= 0) { const [h, ...b] = out; b.sort((x, y) => { const a = num(x[si]), bb = num(y[si]); const r = Number.isFinite(a) && Number.isFinite(bb) ? a - bb : String(x[si]).localeCompare(String(y[si])); return p.desc ? -r : r; }); out = [h, ...b]; } }
    if (p?.limit) out = out.slice(0, Number(p.limit) + 1);
    const md = [out[0], out[0].map(() => "---"), ...out.slice(1, 51)].map((r) => `| ${r.join(" | ")} |`).join("\n");
    const fmt = p?.format ?? "csv";
    const file = fmt === "xlsx" ? { name: "query-result.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: writeXlsx([{ name: "Result", rows: out }]) } : fmt === "json" ? txt("query-result.json", JSON.stringify(P.rowsToObjects(out.map((r) => r.map((v) => String(v)))), null, 2), "application/json") : txt("query-result.csv", P.toCsv(out), "text/csv");
    return { text: `${out.length - 1} row(s).\n\n${md}`, data: { rows: out.length - 1 }, files: [file], table: out };
  } },
  { id: "convert_data", category: "File conversion", desc: "Convert structured data: JSON↔YAML, JSON↔CSV, CSV→Excel, Excel→CSV/JSON, or pretty-print/validate JSON", params: '{"to": "json"|"yaml"|"csv"|"xlsx", "text"?: string}', run: async (c, p) => {
    const to = String(p?.to ?? "json").toLowerCase(); const f = c.files.length ? pick(c, p) : null; const name = f ? base(f.name) : "data";
    const raw = p?.text ?? (f && kindOf(f) !== "xlsx" ? strFromU8(f.bytes) : c.lastText);
    const YAML = await import("yaml");
    let value: any;
    if (f && kindOf(f) === "xlsx" || /\.csv$/i.test(f?.name ?? "")) value = P.rowsToObjects((await tableOf(c, p)).map((r) => r.map((v) => String(v ?? ""))));
    else { const t = String(raw ?? "").trim(); try { value = JSON.parse(t); } catch { try { value = YAML.parse(t); } catch (e: any) { throw new Error(`Couldn't read the data: ${e.message}`); } } }
    if (to === "yaml") { const y = YAML.stringify(value); return { text: "```yaml\n" + y.slice(0, 5000) + "\n```", files: [txt(`${name}.yaml`, y, "application/yaml")] }; }
    if (to === "csv" || to === "xlsx") { const rows = P.objectsToRows(Array.isArray(value) ? value : [value]); return to === "csv" ? { text: `${rows.length - 1} rows.`, files: [txt(`${name}.csv`, P.toCsv(rows), "text/csv")] } : { text: `${rows.length - 1} rows.`, files: [{ name: `${name}.xlsx`, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: writeXlsx([{ name, rows }]) }] }; }
    const j = JSON.stringify(value, null, 2); return { text: "Valid data.\n\n```json\n" + j.slice(0, 5000) + "\n```", files: [txt(`${name}.json`, j, "application/json")] };
  } },
  // Charts & diagrams
  { id: "chart", category: "Charts & visualization", desc: "Draw a bar, line or pie chart as SVG from given labels/values or from two columns of an attached table", params: '{"type": "bar"|"line"|"pie", "title"?: string, "labels"?: string[], "values"?: number[], "label_column"?: string, "value_column"?: string}', run: async (c, p) => {
    let labels: string[] = p?.labels, values: number[] = p?.values?.map(Number);
    if (!labels?.length) {
      const rows = await tableOf(c, p); const head = rows[0].map(String);
      const find = (name: unknown) => { if (!name) return -1; const n = String(name).toLowerCase(); let i = head.findIndex((h) => h.toLowerCase() === n); if (i < 0) i = head.findIndex((h) => h.toLowerCase().includes(n) || n.includes(h.toLowerCase())); return i; };
      const isNum = (i: number) => rows.slice(1).every((r) => Number.isFinite(Number(String(r[i]).replace(/,/g, ""))));
      let li = find(p?.label_column); if (li < 0) li = Math.max(0, head.findIndex((_, i) => !isNum(i)));
      let vi = find(p?.value_column); if (vi < 0 || !isNum(vi)) vi = head.findIndex((_, i) => i !== li && isNum(i));
      if (li < 0 || vi < 0) throw new Error(`Pick columns to chart. Columns: ${head.join(", ")}`);
      const body = rows.slice(1, 61); labels = body.map((r) => String(r[li])); values = body.map((r) => Number(String(r[vi]).replace(/,/g, "")));
      p = { ...p, title: p?.title || `${head[vi]} by ${head[li]}` };
    }
    const svg = P.chartSvg(p?.type ?? "bar", labels, values, p?.title ?? "");
    return { text: `${p?.type ?? "bar"} chart with ${labels.length} points.`, preview: { kind: "svg", content: svg }, files: [txt(`${P.slugify(p?.title || "chart") || "chart"}.svg`, svg, "image/svg+xml")] };
  } },
  { id: "diagram", category: "Charts & visualization", desc: "Create a flowchart, sequence, class, ER, mind map or Gantt diagram (Mermaid source + viewable HTML)", params: '{"description": string}', run: async (c, p) => {
    const src = clean(await c.complete("Write one valid Mermaid diagram for the request. Output only Mermaid code, no fences, no explanation.", `${p?.description || "Diagram"}${c.lastText ? `\n\nBased on:\n${c.lastText.slice(0, 8000)}` : ""}`, 2000)).replace(/^```(mermaid)?\s*|```\s*$/g, "").trim();
    if (!/^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram|gantt|pie|mindmap|journey|timeline)/m.test(src)) throw new Error("The diagram came back in an unexpected format. Please try again.");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Diagram</title></head><body><pre class="mermaid">${src.replace(/</g, "&lt;")}</pre><script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";m.initialize({startOnLoad:true});</script></body></html>`;
    return { text: "```mermaid\n" + src + "\n```", files: [txt("diagram.mmd", src), txt("diagram.html", html, "text/html")] };
  } },
  // QR
  { id: "qr_code", category: "QR & barcodes", desc: "Make a QR code (SVG) for text, a link, Wi-Fi details or contact info", params: '{"content": string}', run: async (_c, p) => {
    if (!p?.content) throw new Error("What should the QR code contain?");
    const QR = await import("qrcode"); const svg = await (QR.default ?? QR).toString(String(p.content).slice(0, 2000), { type: "svg", margin: 2, errorCorrectionLevel: "M" });
    return { text: `QR code for: ${String(p.content).slice(0, 120)}`, preview: { kind: "svg", content: svg }, files: [txt("qr-code.svg", svg, "image/svg+xml")] };
  } },
  { id: "barcode", category: "QR & barcodes", desc: "Make a linear barcode (SVG) — Code 128, Code 39, EAN-13, EAN-8, UPC-A or UPC-E; invalid values are reported, never altered. Not for QR codes", params: '{"format": "code128"|"code39"|"ean13"|"ean8"|"upca"|"upce", "value": string}', run: async (_c, p) => {
    const B = await import("./barcode");
    const format = B.normalizeFormat(p?.format ?? "code128");
    if (!format) throw new Error(`Unsupported barcode format "${p?.format}". Use Code 128, Code 39, EAN-13, EAN-8, UPC-A or UPC-E.`);
    const value = String(p?.value ?? p?.content ?? "");
    const svg = B.barcodeSvg(format, value);
    return { text: `${B.BARCODE_LABELS[format]} barcode for \`${value.slice(0, 80)}\``, preview: { kind: "svg", content: svg }, files: [txt(`barcode-${format}.svg`, svg, "image/svg+xml")] };
  } },
  // Security & encoding
  { id: "hash", category: "Security & privacy", desc: "SHA-1/256/384/512 checksum of text or every attached file; optionally verify against an expected hash", params: '{"algorithm"?: string, "text"?: string, "expected"?: string}', run: async (c, p) => {
    const items = p?.text ? [{ name: "text", bytes: strToU8(p.text) }] : c.files.length ? c.files : c.lastText ? [{ name: "previous result", bytes: strToU8(c.lastText) }] : [];
    if (!items.length) throw new Error("Give me text or attach a file to hash.");
    const res: any[] = []; for (const it of items) res.push({ name: it.name, ...(await sha(p?.algorithm ?? "sha256", it.bytes)) });
    const exp = p?.expected?.toLowerCase().trim();
    return { data: res, text: res.map((r) => `- **${r.name}** ${r.algorithm}: \`${r.hex}\`${exp ? (r.hex === exp ? " ✅ matches" : " ❌ does not match") : ""}`).join("\n") };
  } },
  { id: "encode", category: "Developer tools", desc: "Base64 / URL / hex encode or decode text; decode JWTs (signature not verified)", params: '{"action": "base64_encode"|"base64_decode"|"url_encode"|"url_decode"|"hex_encode"|"hex_decode"|"jwt_decode", "text"?: string}', run: async (c, p) => {
    const t = await inputText(c, p); const b = (s: Uint8Array) => { let r = ""; for (let i = 0; i < s.length; i += 0x8000) r += String.fromCharCode(...s.subarray(i, i + 0x8000)); return btoa(r); };
    let out: string;
    switch (p?.action) {
      case "base64_decode": out = strFromU8(Uint8Array.from(atob(t.trim().replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0))); break;
      case "url_encode": out = encodeURIComponent(t); break;
      case "url_decode": out = decodeURIComponent(t); break;
      case "hex_encode": out = Array.from(strToU8(t), (x) => x.toString(16).padStart(2, "0")).join(""); break;
      case "hex_decode": out = strFromU8(Uint8Array.from(t.replace(/\s/g, "").match(/../g) ?? [], (h) => parseInt(h, 16))); break;
      case "jwt_decode": out = JSON.stringify(P.decodeJwt(t), null, 2); break;
      default: out = b(c.files.length && !p?.text ? pick(c, p).bytes : strToU8(t));
    }
    return { text: "```\n" + out.slice(0, 8000) + "\n```", files: out.length > 8000 ? [txt("output.txt", out)] : undefined };
  } },
  { id: "generate_secret", category: "Security & privacy", desc: "Generate strong passwords or UUIDs", params: '{"kind": "password"|"uuid", "count"?: number, "length"?: number, "symbols"?: boolean}', run: async (_c, p) => {
    const n = Math.min(Math.max(Number(p?.count) || 1, 1), 50);
    const list = Array.from({ length: n }, () => (p?.kind === "uuid" ? crypto.randomUUID() : P.generatePassword(Number(p?.length) || 20, { symbols: p?.symbols })));
    return { text: list.map((x) => `\`${x}\``).join("\n") };
  } },
  { id: "privacy_scan", category: "Security & privacy", desc: "Find secrets (API keys, tokens, private keys) and personal data in text/files; optionally output a redacted copy", params: '{"redact"?: boolean}', run: async (c, p) => {
    const t = await inputText(c, p); const secrets = findSecretKinds(t); const red = P.redactPii(t);
    const lines = [`- Secrets found: ${secrets.length ? secrets.join(", ") : "none"}`, ...Object.entries(red.counts).map(([k, v]) => `- ${k}: ${v}`)];
    if (!Object.keys(red.counts).length) lines.push("- Personal data (emails, phones, cards, IPs): none found");
    return { text: lines.join("\n"), data: { secrets, pii: red.counts }, files: p?.redact ? [txt("redacted.txt", red.text)] : undefined };
  } },
  { id: "validate", category: "Data validation & integrity", desc: "Validate values: email, url, json, card (Luhn), ipv4, uuid", params: '{"kind": string, "values": string[]}', run: async (_c, p) => {
    const vals: string[] = Array.isArray(p?.values) ? p.values : [String(p?.values ?? "")];
    const res = vals.slice(0, 500).map((v) => ({ value: v, ...P.validateValue(String(p?.kind), v) }));
    return { data: res, text: res.map((r) => `- ${r.valid ? "✅" : "❌"} \`${r.value.slice(0, 80)}\`${r.reason ? ` — ${r.reason}` : ""}`).join("\n") };
  } },
  // Web
  { id: "web_fetch", category: "Webpage & HTML processing", desc: "Fetch a public webpage and extract its title, description, headings, links and readable text", params: '{"url": string, "save_as"?: "md"|"txt"|"pdf"}', run: async (c, p) => {
    if (!P.isPublicHttpUrl(p?.url ?? "")) throw new Error("Only public http(s) web addresses can be fetched.");
    await c.stage?.("fetching", `Fetching ${new URL(p.url).hostname}`);
    await c.note(`Fetching ${new URL(p.url).hostname}`);
    const res = await fetch(p.url, { redirect: "follow", headers: { "User-Agent": "VISION-bot/1.0", Accept: "text/html,text/plain" }, signal: AbortSignal.timeout(20000) });
    if (!P.isPublicHttpUrl(res.url)) throw new Error("The page redirected to a private address.");
    if (!res.ok) throw new Error(`The site answered ${res.status}.`);
    const reader = res.body!.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 3_000_000) { await reader.cancel(); break; } chunks.push(value); }
    const html = new TextDecoder().decode(chunks.length === 1 ? chunks[0] : new Uint8Array(chunks.flatMap((x) => Array.from(x))));
    const h = P.htmlExtract(html, res.url);
    const md = `# ${h.title ?? p.url}\n\n${h.description ? `> ${h.description}\n\n` : ""}${h.text.slice(0, 100000)}`;
    const files = p?.save_as ? [await buildDocument(p.save_as, h.title ?? "page", md)] : [txt("page.md", md, "text/markdown")];
    return { text: md.slice(0, 3000), data: { title: h.title, description: h.description, headings: h.headings.slice(0, 30), links: h.links.slice(0, 50) }, files };
  } },
  { id: "github_repo", category: "Repository analysis", desc: "Analyze a PUBLIC GitHub repository (link or owner/name): metadata, README, file tree, dependency manifests and entry points, then answer the question from the retrieved files only", params: '{"repo": string, "question"?: string}', run: async (c, p) => repoTool(c, p, async () => (await import("@/lib/repos/github.server")).fetchGithubRepo(String(p?.repo ?? ""))) },
  { id: "gitlab_repo", category: "Repository analysis", desc: "Analyze a PUBLIC GitLab (gitlab.com) repository (link or owner/name): metadata, README, file tree, dependency manifests and entry points, then answer the question from the retrieved files only", params: '{"repo": string, "question"?: string}', run: async (c, p) => repoTool(c, p, async () => (await import("@/lib/repos/gitlab.server")).fetchGitlabRepo(String(p?.repo ?? ""))) },
  { id: "bitbucket_repo", category: "Repository analysis", desc: "Analyze a PUBLIC Bitbucket repository (link or owner/name): metadata, README, file tree, dependency manifests and entry points, then answer the question from the retrieved files only", params: '{"repo": string, "question"?: string}', run: async (c, p) => repoTool(c, p, async () => (await import("@/lib/repos/bitbucket.server")).fetchBitbucketRepo(String(p?.repo ?? ""))) },
  { id: "web_search", category: "Search & retrieval", desc: "Search the web and return sources", params: '{"query": string}', run: async (_c, p) => {
    const { webSearch } = await import("@/lib/search/search.server"); const r = await webSearch(String(p?.query ?? ""));
    if (r.status === "failed") throw new Error("Web search is unavailable right now — no sources could be reached.");
    if (!r.results.length) throw new Error("The web search ran but returned no results.");
    return { data: r.results, text: r.results.slice(0, 10).map((x, i) => `${i + 1}. [${x.title}](${x.url}) — ${x.snippet}`).join("\n") };
  } },
  { id: "search_files", category: "Search & retrieval", desc: "Search inside all attached files (including PDFs, Word, Excel, ZIP text files) for words", params: '{"query": string}', run: async (c, p) => {
    const q = String(p?.query ?? "").toLowerCase(); if (!q) throw new Error("What should I look for?");
    const hits: string[] = [];
    for (const f of c.files) {
      const docs: [string, string][] = kindOf(f) === "zip" ? (() => { const r = readArchiveSafely(f.bytes); if (!r.ok) throw new Error(r.issues[0].message); return r.entries.filter((e) => e.text).map((e) => [`${f.name}/${e.path}`, e.text!] as [string, string]); })() : [[f.name, await textOf(f, c)]];
      for (const [n, t] of docs) t.split(/\r?\n/).forEach((l, i) => { if (l.toLowerCase().includes(q) && hits.length < 300) hits.push(`- **${n}:${i + 1}** ${l.trim().slice(0, 200)}`); });
    }
    return { text: hits.length ? `${hits.length} match(es):\n\n${hits.slice(0, 80).join("\n")}` : "No matches." };
  } },
  // Archives, backup, e-books
  { id: "zip_create", category: "Backup, export & import", desc: "Bundle the attached files and/or files produced by earlier steps into one ZIP", params: '{"name"?: string}', run: async (c, p) => {
    if (!c.files.length) throw new Error("There are no files to put in a ZIP.");
    const z: Record<string, Uint8Array> = {}; for (const f of c.files) { let n = f.name.replace(/[\\/]/g, "_"), k = 1; while (z[n]) n = `${base(f.name)}-${++k}.${ext(f.name)}`; z[n] = f.bytes; }
    return { text: `Packed ${c.files.length} file(s).`, files: [{ name: `${P.slugify(p?.name || "files") || "files"}.zip`, mime: "application/zip", bytes: zipSync(z, { level: 6 }) }] };
  } },
  { id: "zip_list", category: "ZIP management", desc: "List the contents of an attached ZIP safely (no extraction, nothing run)", params: "{}", run: async (c, p) => {
    const f = pick(c, p, ["zip"]); const r = readArchiveSafely(f.bytes); if (!r.ok) throw new Error(r.issues.slice(0, 3).map((i) => i.message).join(" "));
    const list = r.entries.filter((e) => !e.dir); return { data: list.map((e) => ({ path: e.path, size: e.size })), text: `${list.length} files:\n\n${list.slice(0, 200).map((e) => `- ${e.path} (${P.fmtBytes(e.size)})`).join("\n")}` };
  } },
  { id: "zip_extract", category: "ZIP management", desc: "Pull selected text files out of an attached ZIP (by path or glob like *.md)", params: '{"paths": string[]}', run: async (c, p) => {
    const f = pick(c, p, ["zip"]); const r = readArchiveSafely(f.bytes); if (!r.ok) throw new Error(r.issues[0].message);
    const pats = (p?.paths ?? ["*"]).map((g: string) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i"));
    const sel = r.entries.filter((e) => e.text != null && pats.some((re: RegExp) => re.test(e.path) || re.test(e.path.split("/").pop()!))).slice(0, 200);
    if (!sel.length) throw new Error("No matching text files in the ZIP.");
    return { text: `Extracted ${sel.length} file(s).`, files: sel.map((e) => txt(e.path.split("/").pop()!, e.text!)) };
  } },
  // Code
  { id: "generate_code", category: "Code generation", desc: "Write a single source file in any language and keep its proper extension", params: '{"request": string, "language": string, "filename"?: string}', run: async (c, p) => {
    const { filenameFor } = await import("@/lib/code-files");
    // Code that is already in the chat is saved as-is; only new or changed code is written.
    const readyCode = c.verbatim?.match(/```([\w+#-]*)\r?\n([\s\S]*?)```/);
    if (!readyCode) await c.stage?.("writing_content", "Writing code");
    const t = readyCode ? readyCode[0] : await c.complete("You write complete, working source code. Reply with exactly one fenced code block tagged with its language. No explanation.", `Language: ${p?.language || "auto"}\n${p?.request || ""}${c.lastText ? `\n\nContext:\n${c.lastText.slice(0, 20000)}` : ""}`, 8000);
    const m = t.match(/```([\w+#-]*)\r?\n([\s\S]*?)```/); const code = (m ? m[2] : t).trimEnd() + "\n"; const lang = (p?.language || m?.[1] || "txt").toLowerCase();
    const name = filenameFor(lang, p?.filename);
    const { syntaxCheck } = await import("@/lib/builder/validate"); const d = /\.(m?js|jsx|ts|tsx)$/.test(name) ? syntaxCheck(name, code) : null;
    return { text: "```" + lang + "\n" + code.slice(0, 12000) + "```" + (d ? `\n\n⚠️ Syntax problem: ${d.message}` : ""), files: [txt(name, code)] };
  } },
  { id: "format_code", category: "Developer tools", desc: "Explain, review or find bugs in code/text from an attached file", params: '{"task": "explain"|"review"|"document"}', run: async (c, p) => { const t = await inputText(c, p); const s = clean(await c.complete("You are a senior engineer. Be specific, cite line numbers or identifiers. Markdown.", `Task: ${p?.task || "review"}\n\n${t.slice(0, 50000)}`, 3000)); return { text: s, preview: { kind: "markdown", content: s } }; } },
];

export function parsePages(spec: unknown, n: number): number[] {
  if (!spec) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (const part of String(spec).split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+|end))?$/i);
    if (!m) throw new Error(`Couldn't read page range "${part}".`);
    const a = +m[1], b = m[2] ? (m[2].toLowerCase() === "end" ? n : +m[2]) : a;
    for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.add(i - 1);
  }
  if (!out.size) throw new Error(`Those pages don't exist (the PDF has ${n}).`);
  return [...out].sort((x, y) => x - y);
}

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.id, t]));
export const catalogText = () => TOOLS.map((t) => `- ${t.id} [${t.category}]: ${t.desc}. params ${t.params}`).join("\n");

/** Re-opens produced files to confirm they are readable before they are offered for download. */
export async function verifyOutput(f: WorkFile): Promise<string | null> {
  try {
    if (!f.bytes.length) return "file is empty";
    const e = ext(f.name);
    const { verifyProduced } = await import("@/lib/formats/convert");
    const bad = verifyProduced(e, f.bytes); if (bad) return bad;
    if (e === "pdf") await PDFDocument.load(f.bytes);
    else if (e === "json") JSON.parse(strFromU8(f.bytes));
    else if (/^(zip|docx|xlsx|epub)$/.test(e)) { const { unzipSync } = await import("fflate"); const z = unzipSync(f.bytes); if (e === "docx" && !z["word/document.xml"]) return "Word file is missing its body"; if (e === "xlsx") readXlsx(f.bytes, 1); }
    else if (e === "svg" && !strFromU8(f.bytes).includes("<svg")) return "not an SVG";
    return null;
  } catch (err: any) { return err?.message ?? "unreadable"; }
}
