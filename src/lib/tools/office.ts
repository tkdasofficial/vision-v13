// Office/document formats built with fflate only (runtime-safe): XLSX read/write, DOCX text, EPUB.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

const x = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref: string) => { let n = 0; for (const c of ref.replace(/\d/g, "")) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export type FormulaCell = { formula: string; value: number | string; style?: number };
export type Sheet = { name: string; rows: unknown[][]; colStyles?: Record<number, number>; widths?: number[] };

/** Optional spreadsheet presentation: frozen header, filters, column widths and
 * numeric formats. Style ids: 0 default, 1 bold header, 2 "0.00", 3 "0.0", 4 integer. */
export type WriteXlsxOpts = { freezeHeader?: boolean; autoFilter?: boolean; widths?: number[]; colStyles?: Record<number, 2 | 3 | 4> };
export const XLSX_STYLE_PRICE = 2, XLSX_STYLE_ONE_DECIMAL = 3, XLSX_STYLE_INTEGER = 4;

export function writeXlsx(sheets: Sheet[], opts: WriteXlsxOpts = {}): Uint8Array {
  if (!sheets.length) throw new Error("No sheets to write.");
  const files: Record<string, Uint8Array> = {};
  const names = sheets.map((s, i) => (s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files["xl/styles.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="$#,##0.00;($#,##0.00);-"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf fontId="0"/><xf fontId="1" applyFont="1"/><xf fontId="0" numFmtId="2" applyNumberFormat="1"/><xf fontId="0" numFmtId="164" applyNumberFormat="1"/><xf fontId="0" numFmtId="1" applyNumberFormat="1"/><xf fontId="0" numFmtId="165" applyNumberFormat="1"/><xf fontId="0" numFmtId="10" applyNumberFormat="1"/><xf fontId="0" numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  sheets.forEach((s, si) => {
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const formula = v && typeof v === "object" && "formula" in v ? v as FormulaCell : null;
      const style = formula?.style ?? (ri === 0 ? 1 : (v !== "" && v != null ? (s.colStyles ?? opts.colStyles)?.[ci] : undefined));
      const st = style ? ` s="${style}"` : "";
      if (formula) {
        if (typeof formula.value === "string") return `<c r="${ref}" t="str"${st}><f>${x(formula.formula.replace(/^=/, ""))}</f><v>${x(formula.value)}</v></c>`;
        if (!Number.isFinite(formula.value)) throw new Error(`Invalid formula result at ${s.name}!${ref}`);
        return `<c r="${ref}"${st}><f>${x(formula.formula.replace(/^=/, ""))}</f><v>${formula.value}</v></c>`;
      }
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      if (typeof v === "boolean") return `<c r="${ref}" t="b"${st}><v>${v ? 1 : 0}</v></c>`;
      if (v == null || v === "") return "";
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(typeof v === "object" ? JSON.stringify(v) : v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const view = opts.freezeHeader ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
    const widths = s.widths ?? opts.widths;
    const cols = widths?.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const lastCol = colName(Math.max(0, (s.rows[0]?.length ?? 1) - 1));
    const filter = opts.autoFilter && s.rows.length ? `<autoFilter ref="A1:${lastCol}${s.rows.length}"/>` : "";
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`);
  });
  return zipSync(files, { level: 6 });
}

export function readXlsx(bytes: Uint8Array, maxRows = 50_000): Sheet[] {
  const z = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") && f.originalSize < 60 * 1024 * 1024 });
  const shared = z["xl/sharedStrings.xml"] ? [...strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))) : [];
  const wb = z["xl/workbook.xml"] ? strFromU8(z["xl/workbook.xml"]) : "";
  const rels = z["xl/_rels/workbook.xml.rels"] ? strFromU8(z["xl/_rels/workbook.xml.rels"]) : "";
  const sheetDefs = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)];
  const out: Sheet[] = [];
  for (const [, name, rid] of sheetDefs) {
    const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
    const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "";
    const xml = z[path] ? strFromU8(z[path]) : "";
    const rows: unknown[][] = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= maxRows) break;
      const row: unknown[] = [];
      for (const c of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] ?? "";
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        const t = attrs.match(/t="(\w+)"/)?.[1];
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val: unknown = "";
        if (t === "s") val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
        else if (t === "b") val = v === "1";
        else if (t === "str" || t === "e") val = unxml(v ?? "");
        else if (v != null) val = Number(v);
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows.push(Array.from(row, (v) => v ?? ""));
    }
    out.push({ name: unxml(name), rows });
  }
  if (!out.length) throw new Error("No sheets found in this workbook.");
  return out;
}

/** Paragraph text from a .docx file (headings, lists and tables flattened). */
export function docxText(bytes: Uint8Array): { text: string; title?: string; author?: string } {
  const z = unzipSync(bytes, { filter: (f) => (f.name === "word/document.xml" || f.name === "docProps/core.xml") && f.originalSize < 60 * 1024 * 1024 });
  const doc = z["word/document.xml"];
  if (!doc) throw new Error("This doesn't look like a Word document.");
  const xml = strFromU8(doc);
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => unxml([...p[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((m) => m[1] ?? "\t").join("")));
  const core = z["docProps/core.xml"] ? strFromU8(z["docProps/core.xml"]) : "";
  return { text: paras.join("\n").replace(/\n{3,}/g, "\n\n").trim(), title: core.match(/<dc:title>([^<]*)/)?.[1], author: core.match(/<dc:creator>([^<]*)/)?.[1] };
}

/** Minimal valid EPUB 3 from chapters of HTML-safe text. */
export function writeEpub(title: string, author: string, chapters: { title: string; html: string }[]): Uint8Array {
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  };
  chapters.forEach((c, i) => { files[`OEBPS/ch${i + 1}.xhtml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${x(c.title)}</title></head><body><h1>${x(c.title)}</h1>${c.html}</body></html>`); });
  files["OEBPS/nav.xhtml"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${x(c.title)}</a></li>`).join("")}</ol></nav></body></html>`);
  files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">${id}</dc:identifier><dc:title>${x(title)}</dc:title><dc:creator>${x(author)}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((_, i) => `<item id="c${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join("")}</spine></package>`);
  return zipSync(files as any);
}

/** Converts simple HTML (from marked) into XHTML-safe markup for EPUB. */
export const toXhtml = (html: string) => html.replace(/<(br|hr|img)([^>]*?)\s*\/?>/g, "<$1$2/>").replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;");
