// Multilingual file export: every supported format × every locale config is generated through the real builders,
// reopened/parsed, and its text compared with the input. PDF checks need network (fonts) and poppler's pdftotext;
// they are skipped, not faked, when either is missing. Set ML_FILES_OUT=dir to keep the files for visual review.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { buildDocument, pdfLostChars } from "@/lib/tools/registry.server";
import { readXlsx } from "@/lib/tools/office";
import { SAMPLES, sampleMarkdown, MIXED } from "./fixtures/multilingual-samples";

const hasPdftotext = (() => { try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();
const out = process.env.ML_FILES_OUT;
if (out) mkdirSync(out, { recursive: true });
const keep = (name: string, bytes: Uint8Array) => { if (out) writeFileSync(`${out}/${name}`, bytes); };
const squash = (s: string) => s.normalize("NFC").replace(/\s+/g, "");

describe("multilingual file export", () => {
  for (const [id, s] of Object.entries(SAMPLES)) {
    const md = sampleMarkdown(id);
    it(`${id}: txt/md/html/docx/epub/csv/xlsx keep Unicode exactly`, async () => {
      for (const fmt of ["txt", "md", "html"]) {
        const f = await buildDocument(fmt, s.title, md); keep(`${id}.${fmt}`, f.bytes);
        const t = strFromU8(f.bytes).replace(/&#39;/g, "'");
        expect(t).toContain(s.text); expect(t).not.toContain("\uFFFD");
        if (fmt === "html") { expect(t).toMatch(new RegExp(`lang="${id}"`)); if (id === "ar" || id === "ur") expect(t).toContain('dir="rtl"'); }
      }
      const d = await buildDocument("docx", s.title, md); keep(`${id}.docx`, d.bytes);
      const xml = strFromU8(unzipSync(d.bytes)["word/document.xml"]).replace(/&apos;/g, "'");
      expect(xml).toContain(s.text);
      if (id === "ar" || id === "ur") expect(xml).toContain("<w:bidi");
      const e = await buildDocument("epub", s.title, md);
      expect(Object.values(unzipSync(e.bytes)).map((b) => strFromU8(b)).join("").replace(/&apos;|&#39;/g, "'")).toContain(s.text);
      const c = await buildDocument("csv", s.title, md); keep(`${id}.csv`, c.bytes);
      const csv = strFromU8(c.bytes);
      expect(csv).toContain(s.cell);
      if (/[^\x00-\x7f]/.test(s.cell)) expect([...c.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // TextDecoder hides the BOM
      const x = await buildDocument("xlsx", s.title, md); keep(`${id}.xlsx`, x.bytes);
      const sheets = readXlsx(x.bytes);
      expect(sheets[0].rows.flat()).toContain(s.cell);
      expect(sheets[0].name).toBe(s.title.slice(0, 31));
    });
    it.skipIf(!hasPdftotext)(`${id}: PDF embeds fonts and extracted text matches (no "?")`, async () => {
      const f = await buildDocument("pdf", s.title, md); keep(`${id}.pdf`, f.bytes);
      expect(pdfLostChars(f.bytes)).toBe(0);
      const p = `/tmp/ml-${id}.pdf`; writeFileSync(p, f.bytes);
      const text = execFileSync("pdftotext", [p, "-"]).toString();
      // Arabic-script text is extracted in visual order and Indic text in glyph (reordered-matra) order, so only
      // Latin/Cyrillic/CJK are compared exactly; the others are checked by codepoint volume and by rendering.
      if (!["ar", "ur", "hi", "bn", "ta"].includes(id)) { expect(squash(text)).toContain(squash(s.text)); expect(squash(text)).toContain(squash(s.title)); }
      else expect((text.match(/[\u0600-\u06ff\ufb50-\ufeff\u0900-\u097f\u0980-\u09ff\u0b80-\u0bff]/g) ?? []).length).toBeGreaterThan(20);
    }, 60000);
  }
  it.skipIf(!hasPdftotext)("mixed RTL/LTR + multi-script PDF draws every character", async () => {
    const f = await buildDocument("pdf", "Mixed", MIXED); keep("mixed.pdf", f.bytes);
    expect(pdfLostChars(f.bytes)).toBe(0);
  }, 60000);
  it("English-only PDFs still use the built-in fonts and fetch nothing", async () => {
    const { markdownToPdf } = await import("@/lib/tools/registry.server");
    let calls = 0;
    const bytes = await markdownToPdf("Plain", "# Hello\n\nJust English – “quotes” and €5.", (async () => { calls++; throw new Error("no"); }) as any);
    expect(calls).toBe(0); expect(pdfLostChars(bytes)).toBe(0);
  });
  it("a font that can't be loaded degrades to '?' with a count instead of failing", async () => {
    const { markdownToPdf } = await import("@/lib/tools/registry.server");
    (await import("@/lib/i18n/pdf-text.server")).resetFontCache();
    const bytes = await markdownToPdf("x", "# 테스트\n\n가나다", (async () => new Response("", { status: 503 })) as any);
    expect(pdfLostChars(bytes)).toBe(6);
  });
});
