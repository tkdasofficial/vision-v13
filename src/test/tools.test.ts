// @vitest-environment node
import { describe, it, expect } from "vitest";
import { strToU8, strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import * as P from "@/lib/tools/pure";
import { writeXlsx, readXlsx, docxText, writeEpub } from "@/lib/tools/office";
import { TOOL_MAP, TOOLS, parsePages, verifyOutput, buildDocument, textOf, type ToolCtx, type WorkFile } from "@/lib/tools/registry.server";
import { parsePlan } from "@/lib/jobs/agent.server";

const ctx = (files: WorkFile[] = [], lastText = ""): ToolCtx => ({ files, lastText, complete: async () => "# Title\n\n| a | b |\n|---|---|\n| x | 1 |", note: async () => {} });
const run = (id: string, c: ToolCtx, p: any = {}) => TOOL_MAP.get(id)!.run(c, p);
const f = (name: string, content: string | Uint8Array, mime = "text/plain"): WorkFile => ({ name, mime, bytes: typeof content === "string" ? strToU8(content) : content });

describe("pure helpers", () => {
  it("evaluates math safely", () => {
    expect(P.evaluate("2+3*4")).toBe(14);
    expect(P.evaluate("2^3^2")).toBe(512);
    expect(P.evaluate("sqrt(16)+5!")).toBe(124);
    expect(() => P.evaluate("constructor.alert(1)")).toThrow();
    expect(() => P.evaluate("1/0")).toThrow();
  });
  it("converts units", () => {
    expect(P.convertUnit(100, "C", "F")).toBeCloseTo(212);
    expect(P.convertUnit(1, "mi", "km")).toBeCloseTo(1.609344);
    expect(() => P.convertUnit(1, "kg", "m")).toThrow(/mass to length/);
  });
  it("parses and writes CSV with quotes", () => {
    const rows = P.parseCsv('a,b\n"x, y","he said ""hi"""\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(P.parseCsv(P.toCsv(rows))).toEqual(rows);
  });
  it("profiles a table", () => {
    const p = P.profileTable([["n", "c"], [1, "a"], [3, "a"], [3, "a"]]);
    expect(p.rows).toBe(3); expect(p.duplicateRows).toBe(1);
    expect(p.columns[0].type).toBe("number"); expect((p.columns[0] as any).stats.mean).toBeCloseTo(7 / 3);
  });
  it("diffs, redacts, validates", () => {
    expect(P.diffLines("a\nb", "a\nc")).toMatchObject({ added: 1, removed: 1 });
    expect(P.redactPii("mail me@x.com").text).toContain("[EMAIL REDACTED]");
    expect(P.validateValue("card", "4111 1111 1111 1111").valid).toBe(true);
    expect(P.validateValue("email", "nope").valid).toBe(false);
  });
  it("blocks private URLs", () => {
    for (const u of ["http://localhost", "http://127.0.0.1", "http://10.0.0.1", "http://192.168.1.1", "file:///etc/passwd", "http://[::1]/", "http://169.254.169.254/"]) expect(P.isPublicHttpUrl(u)).toBe(false);
    expect(P.isPublicHttpUrl("https://example.com/a")).toBe(true);
  });
  it("reads image sizes from headers", () => {
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 640); new DataView(png.buffer).setUint32(20, 480);
    expect(P.imageSize(png)).toEqual({ width: 640, height: 480 });
  });
  it("makes chart SVG and rejects bad data", () => {
    expect(P.chartSvg("pie", ["a", "b"], [1, 3])).toContain("75.0%");
    expect(() => P.chartSvg("bar", ["a"], [1, 2])).toThrow();
  });
  it("generates strong passwords and decodes JWTs", () => {
    const pw = P.generatePassword(24); expect(pw).toHaveLength(24); expect(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)).toBe(true);
    const jwt = `${btoa('{"alg":"none"}')}.${btoa('{"sub":"1","exp":1}')}.x`;
    expect(P.decodeJwt(jwt)).toMatchObject({ payload: { sub: "1" }, expired: true, signatureVerified: false });
  });
});

describe("office formats", () => {
  it("round-trips XLSX", () => {
    const bytes = writeXlsx([{ name: "S", rows: [["name", "n"], ["a & b", 2], ["c", 3.5]] }]);
    expect(readXlsx(bytes)[0].rows).toEqual([["name", "n"], ["a & b", 2], ["c", 3.5]]);
  });
  it("writes a valid EPUB with stored mimetype first", () => {
    const z = unzipSync(writeEpub("T", "A", [{ title: "One", html: "<p>Hi</p>" }]));
    expect(Object.keys(z)[0]).toBe("mimetype");
    expect(strFromU8(z["OEBPS/content.opf"])).toContain("<dc:title>T</dc:title>");
  });
  it("builds DOCX and PDF that re-open with their text", async () => {
    const md = "# Report\n\nHello **world** – café\n\n- item";
    const docx = await buildDocument("docx", "Report", md);
    expect(docxText(docx.bytes).text).toContain("Hello world");
    const pdf = await buildDocument("pdf", "Report", md);
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
    expect(await textOf(pdf)).toContain("Hello world");
    expect(await verifyOutput(pdf)).toBeNull();
    expect(await verifyOutput(f("x.json", "{bad"))).not.toBeNull();
  });
});

describe("tools", () => {
  it("every tool has an id, category and params", () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.category)).size).toBeGreaterThanOrEqual(20);
  });
  it("parses page ranges", () => { expect(parsePages("1-2,4", 5)).toEqual([0, 1, 3]); expect(parsePages("3-end", 4)).toEqual([2, 3]); expect(() => parsePages("9", 2)).toThrow(); });
  it("merges and splits PDFs", async () => {
    const a = await buildDocument("pdf", "A", "a"), b = await buildDocument("pdf", "B", "b");
    const m = await run("pdf_merge", ctx([a, b]));
    expect((await PDFDocument.load(m.files![0].bytes)).getPageCount()).toBe(2);
    const s = await run("pdf_pages", ctx([m.files![0]]), { action: "extract", pages: "2" });
    expect((await PDFDocument.load(s.files![0].bytes)).getPageCount()).toBe(1);
    const z = await run("pdf_pages", ctx([m.files![0]]), { action: "split_each" });
    expect(Object.keys(unzipSync(z.files![0].bytes))).toHaveLength(2);
  });
  it("queries and charts table data", async () => {
    const csv = f("sales.csv", "region,amount\nN,10\nS,5\nN,7\n", "text/csv");
    const q = await run("query_data", ctx([csv]), { group_by: "region", aggregate: { column: "amount", fn: "sum" }, sort_by: "region" });
    expect(strFromU8(q.files![0].bytes)).toBe("region,sum(amount)\nN,17\nS,5\n");
    const c = await run("chart", ctx([csv]), { type: "bar" });
    expect(c.preview!.content).toContain("<svg");
    const a = await run("analyze_data", ctx([csv]));
    expect((a.data as any).rows).toBe(3);
  });
  it("converts data and documents", async () => {
    const y = await run("convert_data", ctx([f("a.json", '[{"x":1}]')]), { to: "yaml" });
    expect(strFromU8(y.files![0].bytes)).toContain("x: 1");
    const x = await run("convert_document", ctx([f("t.csv", "a,b\n1,2\n")]), { to: "xlsx" });
    expect(readXlsx(x.files![0].bytes)[0].rows).toEqual([["a", "b"], [1, 2]]);
    const d = await run("convert_document", ctx([f("n.md", "# Hi\n\ntext")]), { to: "docx" });
    expect(d.files![0].name).toBe("n.docx");
  });
  it("hashes, encodes, scans, makes QR codes and ZIPs", async () => {
    const h = await run("hash", ctx(), { text: "abc", expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
    expect(h.text).toContain("matches");
    expect((await run("encode", ctx(), { action: "base64_encode", text: "hi" })).text).toContain("aGk=");
    const s = await run("privacy_scan", ctx(), { text: "key AKIAABCDEFGHIJKLMNOP email a@b.co", redact: true });
    expect(strFromU8(s.files![0].bytes)).toContain("[EMAIL REDACTED]");
    expect((await run("qr_code", ctx(), { content: "https://example.com" })).files![0].name).toBe("qr-code.svg");
    const z = await run("zip_create", ctx([f("a.txt", "1"), f("a.txt", "2")]));
    expect(Object.keys(unzipSync(z.files![0].bytes)).sort()).toEqual(["a-2.txt", "a.txt"]);
  });
  it("creates documents from AI text in the requested format", async () => {
    const r = await run("create_document", ctx(), { request: "table", format: "xlsx" });
    expect(readXlsx(r.files![0].bytes)[0].rows).toEqual([["a", "b"], ["x", 1]]);
  });
  it("refuses private web fetches", async () => { await expect(run("web_fetch", ctx(), { url: "http://127.0.0.1/admin" })).rejects.toThrow(/public/); });
});

describe("planner", () => {
  it("accepts known tools, rejects unknown, caps steps", () => {
    const known = (id: string) => TOOL_MAP.has(id);
    expect(parsePlan('ok {"steps":[{"tool":"hash","params":{"text":"a"}}]}', known).steps[0].tool).toBe("hash");
    expect(() => parsePlan('{"steps":[{"tool":"rm_rf"}]}', known)).toThrow(/unknown/);
    expect(parsePlan(JSON.stringify({ steps: Array(9).fill({ tool: "hash" }) }), known).steps).toHaveLength(6);
    expect(parsePlan('{"steps":[],"reply":"hi"}', known).reply).toBe("hi");
  });
});

describe("file test-pass regressions", () => {
  it("refuses to turn prose into fake spreadsheet rows", async () => {
    await expect(run("convert_document", ctx([f("notes.txt", "Plain line\nAnother line")]), { to: "xlsx" })).rejects.toThrow(/no table/);
    await expect(run("convert_document", ctx([f("p.html", "<h1>Hi</h1><p>text</p>", "text/html")]), { to: "csv" })).rejects.toThrow(/no table/);
  });
  it("converts only the Markdown table from a document", async () => {
    const o = await run("convert_document", ctx([f("r.md", "# R\n\nIntro\n\n| Region | Q1 |\n|---|---|\n| North | 120 |")]), { to: "csv" });
    expect(strFromU8(o.files![0].bytes)).toBe("Region,Q1\nNorth,120\n");
  });
  // Hindi is now drawn with an embedded Devanagari font (multilingual export); only glyphs no font has (emoji) warn.
  it("draws Hindi in PDFs and warns only for characters no font can draw", async () => {
    const hi = await run("create_document", { ...ctx(), complete: async () => "# T\n\nहिंदी" }, { format: "pdf" });
    expect(hi.text).not.toMatch(/character\(s\)/);
    const emoji = await run("create_document", { ...ctx(), complete: async () => "# T\n\nहिंदी 😀" }, { format: "pdf" });
    expect(emoji.text).toMatch(/1 character\(s\).*"\?"/);
  }, 60000);
  it("reports a damaged PDF instead of crashing", async () => {
    await expect(run("pdf_merge", ctx([f("a.pdf", "%PDF-1.4 x", "application/pdf"), f("b.pdf", "nope", "application/pdf")]))).rejects.toThrow(/damaged or not a valid PDF/);
  });
});
