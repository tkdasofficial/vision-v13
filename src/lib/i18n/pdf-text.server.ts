// Multilingual text drawing for pdf-lib. Server-only (fetches fonts at runtime, cached per worker instance).
// Latin text that the built-in PDF fonts can draw keeps using them (unchanged output for English documents);
// every other character is drawn with an embedded, subsetted Noto font for its script. Shaping (Arabic joining,
// Indic conjuncts) is done by fontkit; this module adds run splitting, a minimal bidi pass for right-to-left
// lines and per-glyph font fallback. Characters no font covers are drawn as "?" and counted.
// @pdf-lib/fontkit's Indic shaper (Devanagari/Bengali/Tamil) calls the global regeneratorRuntime.
import "regenerator-runtime/runtime";
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts, rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { chineseVariant, localeById } from "./locales";

export type Style = "regular" | "bold" | "mono";
type Slot = "std" | "latin" | "deva" | "beng" | "taml" | "arab" | "hang" | "jp" | "sc" | "tc";
const URL: Record<Exclude<Slot, "std">, string> = {
  latin: localeById("en")!.pdfFont, deva: localeById("hi")!.pdfFont, beng: localeById("bn")!.pdfFont, taml: localeById("ta")!.pdfFont,
  arab: localeById("ar")!.pdfFont, hang: localeById("ko")!.pdfFont, jp: localeById("ja")!.pdfFont, sc: localeById("zh-CN")!.pdfFont, tc: localeById("zh-TW")!.pdfFont,
};
/** Characters the standard PDF fonts (WinAnsi) can draw. */
export const WIN_OK = /[\x09\x0a\x0d\x20-\x7e\xa0-\xff€‘’“”•–—…]/;

const bytesCache = new Map<string, Promise<Uint8Array | null>>();
const parsedCache = new Map<string, any>();
/** Fetches a font once per worker; a failure is cached as null so a document never waits on a dead CDN twice. */
export function loadFont(url: string, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetcher(url).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
    bytesCache.set(url, p);
  }
  return p;
}
/** Test hook: forget cached fonts (and cached failures). */
export function resetFontCache() { bytesCache.clear(); parsedCache.clear(); }
const parsed = (url: string, bytes: Uint8Array) => { let f = parsedCache.get(url); if (!f) { f = fontkit.create(bytes as any); parsedCache.set(url, f); } return f; };

const RTL_CHAR = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const STRONG_LTR = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0900-\u0dff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
function scriptSlot(cp: number, han: Slot): Slot | "neutral" {
  if (cp >= 0x30 && cp <= 0x39) return "latin"; // digits are left-to-right runs, never reversed inside RTL text
  if (cp <= 0x40 || (cp >= 0x5b && cp <= 0x60) || (cp >= 0x7b && cp <= 0xbf) || (cp >= 0x2000 && cp <= 0x206f)) return "neutral";
  if (cp >= 0x0900 && cp <= 0x097f) return "deva";
  if (cp >= 0x0980 && cp <= 0x09ff) return "beng";
  if (cp >= 0x0b80 && cp <= 0x0bff) return "taml";
  if ((cp >= 0x0600 && cp <= 0x08ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return "arab";
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) return "hang";
  if (cp >= 0x3040 && cp <= 0x30ff) return "jp";
  if ((cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0xf900 && cp <= 0xfaff)) return han;
  return "latin";
}

export type TextKit = {
  /** Width of text in points. */ width(text: string, style: Style, size: number): number;
  /** Draws one already-wrapped line; right-to-left lines are right-aligned within maxWidth. */
  draw(page: PDFPage, text: string, x: number, y: number, size: number, style: Style, maxWidth: number): void;
  isRtl(text: string): boolean;
  lost(): number;
};

export async function createTextKit(doc: PDFDocument, allText: string, fetcher: typeof fetch = fetch): Promise<TextKit> {
  const std: Record<Style, PDFFont> = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), mono: await doc.embedFont(StandardFonts.Courier) };
  const han: Slot = /[\u3040-\u30ff]/.test(allText) ? "jp" : chineseVariant(allText) === "zh-TW" ? "tc" : "sc";
  const needed = new Set<Exclude<Slot, "std">>();
  for (const ch of allText) { if (WIN_OK.test(ch)) continue; const s = scriptSlot(ch.codePointAt(0)!, han); if (s !== "neutral" && s !== "std") needed.add(s); }
  if ([...needed].some((s) => ["sc", "tc", "jp"].includes(s))) for (const s of ["sc", "tc", "jp"] as const) needed.add(s); // per-glyph fallback across CJK fonts
  if (needed.size) { needed.add("latin"); doc.registerFontkit(fontkit); }
  const fonts = new Map<Slot, { pdf: PDFFont; fk: any }>();
  await Promise.all([...needed].map(async (s) => {
    const bytes = await loadFont(URL[s], fetcher); if (!bytes) return;
    try { fonts.set(s, { pdf: await doc.embedFont(bytes, { subset: true }), fk: parsed(URL[s], bytes) }); } catch { /* unusable font file: fall back */ }
  }));
  let lost = 0;
  const order: Slot[] = ["latin", han, "sc", "tc", "jp", "hang", "deva", "beng", "taml", "arab"];
  const fontFor = (ch: string, style: Style, slot: Slot, count: boolean): { font: PDFFont; ch: string } => {
    if (WIN_OK.test(ch) && slot !== "arab") return { font: std[style], ch };
    const cp = ch.codePointAt(0)!;
    for (const s of [slot, ...order]) { const f = fonts.get(s); if (f && f.fk.hasGlyphForCodePoint(cp)) return { font: f.pdf, ch }; }
    if (WIN_OK.test(ch)) return { font: std[style], ch };
    if (count) lost++; return { font: std[style], ch: "?" };
  };
  type Run = { text: string; font: PDFFont; rtl: boolean };
  const fkOf = new Map<PDFFont, any>(); for (const f of fonts.values()) fkOf.set(f.pdf, f.fk);
  // A neutral character (space, punctuation) joins a run only if that run's font really has the glyph.
  const canDraw = (font: PDFFont, s: string) => { const fk = fkOf.get(font); return fk ? [...s].every((c) => fk.hasGlyphForCodePoint(c.codePointAt(0)!)) : [...s].every((c) => WIN_OK.test(c)); };
  const runsOf = (text: string, style: Style, count = false): Run[] => {
    const runs: Run[] = [];
    let pendingNeutral = "";
    for (const ch of text) {
      const s = scriptSlot(ch.codePointAt(0)!, han);
      if (s === "neutral" && runs.length) { pendingNeutral += ch; continue; }
      const slot = s === "neutral" ? "latin" : s;
      const { font, ch: out } = fontFor(ch, style, slot, count);
      const rtl = RTL_CHAR.test(ch);
      const last = runs[runs.length - 1];
      if (last && last.font === font && last.rtl === rtl && canDraw(font, pendingNeutral)) last.text += pendingNeutral + out;
      else {
        if (pendingNeutral && last) { if (canDraw(last.font, pendingNeutral)) last.text += pendingNeutral; else runs.push({ text: pendingNeutral, font: std[style], rtl: false }); }
        runs.push({ text: out, font, rtl });
      }
      pendingNeutral = "";
    }
    if (pendingNeutral) { const last = runs[runs.length - 1]; if (last && canDraw(last.font, pendingNeutral)) last.text += pendingNeutral; else runs.push({ text: pendingNeutral, font: std[style], rtl: false }); }
    return runs.map((r) => (r.font === std[style] ? { ...r, text: [...r.text].map((c) => (WIN_OK.test(c) ? c : "?")).join("") } : r));
  };
  const isRtl = (text: string) => { for (const ch of text) { if (RTL_CHAR.test(ch)) return true; if (STRONG_LTR.test(ch)) return false; } return false; };
  const width = (text: string, style: Style, size: number) => runsOf(text, style).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
  return {
    width, isRtl, lost: () => lost,
    draw(page, text, x, y, size, style, maxWidth) {
      let runs = runsOf(text, style, true);
      const rtl = isRtl(text);
      // Minimal bidi: in a right-to-left line the runs are laid out right-to-left; fontkit already orders
      // glyphs inside an Arabic-script run visually, and left-to-right runs (numbers, Latin) keep their order.
      if (rtl) runs = runs.reverse();
      const total = runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
      let cx = rtl ? x + Math.max(0, maxWidth - total) : x;
      for (const r of runs) { if (r.text) page.drawText(r.text, { x: cx, y, size, font: r.font, color: rgb(0.1, 0.1, 0.12) }); cx += r.font.widthOfTextAtSize(r.text, size); }
    },
  };
}
