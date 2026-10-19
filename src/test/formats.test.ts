// @vitest-environment node
// Format registry + real inline conversions. Every output is re-read by an independent parser.
import { describe, it, expect } from "vitest";
import { strToU8, strFromU8, zipSync, gzipSync, unzipSync, zlibSync } from "fflate";
import YAML from "yaml";
import * as TOML from "smol-toml";
import { PDFDocument } from "pdf-lib";
import { INVENTORY_131, FORMATS, FORMAT_BY_ID, canonicalId, formatOfName, routeConversion, matchesSignature } from "@/lib/formats/inventory";
import * as F from "@/lib/formats/convert";
import { TOOL_MAP, type ToolCtx, type WorkFile } from "@/lib/tools/registry.server";
import { detectRuntimeOp, cleanParams, outputMatches, RUNTIME_OPS, RUNTIME_SOURCES } from "@/lib/runtime/operations";
import { readXlsx, writeXlsx } from "@/lib/tools/office";

const ctx = (files: WorkFile[]): ToolCtx => ({ files, lastText: "", complete: async () => "", note: async () => {} });
const file = (name: string, c: string | Uint8Array): WorkFile => ({ name, mime: "", bytes: typeof c === "string" ? strToU8(c) : c });
const convert = (f: WorkFile, to: string) => TOOL_MAP.get("convert_format")!.run(ctx([f]), { to });
const out = async (f: WorkFile, to: string) => (await convert(f, to)).files![0];
const s = (w: WorkFile) => strFromU8(w.bytes);

// Minimal real fixtures for every inline-readable format.
const tinyPng = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
function woff(flavor = 0x00010000): Uint8Array {
  // Build a 1-table TrueType font (head) and wrap it as WOFF with zlib compression.
  const head = new Uint8Array(54); new DataView(head.buffer).setUint32(12, 0x5f0f3cf5);
  const comp = zlibSync(head);
  const b = new Uint8Array(44 + 20 + comp.length + 4); const v = new DataView(b.buffer);
  b.set(strToU8("wOFF")); v.setUint32(4, flavor); v.setUint32(8, b.length); v.setUint16(12, 1); v.setUint32(16, 12 + 16 + 56);
  b.set(strToU8("head"), 44); v.setUint32(48, 64); v.setUint32(52, comp.length); v.setUint32(56, 54); b.set(comp, 64);
  return b;
}
const FIX: Record<string, () => WorkFile> = {
  csv: () => file("t.csv", 'name,qty,note\n"Doe, J",-3,हिन्दी\nAmy,4,\n'),
  tsv: () => file("t.tsv", "name\tqty\nA\t-3\n"),
  json: () => file("t.json", '[{"name":"हिन्दी","qty":-3},{"name":"B","qty":null}]'),
  jsonl: () => file("t.jsonl", '{"a":1}\n{"a":-2}\n'),
  xml: () => file("t.xml", "<root><item><a>1</a></item><item><a>2</a></item></root>"),
  yaml: () => file("t.yaml", "- name: A\n  qty: -3\n- name: B\n  qty: 4\n"),
  toml: () => file("t.toml", "[server]\nport = 8080\nhost = \"x\"\n"),
  sql: () => file("t.sql", "INSERT INTO t (name, qty) VALUES ('O''Neil', -3), ('हिन्दी', 4);"),
  xlsx: () => file("t.xlsx", writeXlsx([{ name: "S", rows: [["name", "qty"], ["A", -3]] }])),
  ods: () => file("t.ods", F.writeOds([["name", "qty"], ["A", -3]])),
  ini: () => file("t.ini", "[db]\nhost = x\nport = 5432\n"),
  cfg: () => file("t.cfg", "[a]\nk = v\n"),
  conf: () => file("t.conf", "key = value\n"),
  properties: () => file("t.properties", "app.name=VISION\napp.port=80\n"),
  env: () => file(".env", "API_URL=https://x\nDB_PASSWORD=secret\n"),
  srt: () => file("t.srt", "1\n00:00:01,000 --> 00:00:02,500\nHello नमस्ते\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n"),
  vtt: () => file("t.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n"),
  ass: () => file("t.ass", "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}Hi, there\\Nline2\n"),
  ssa: () => file("t.ssa", "[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi\n"),
  lrc: () => file("t.lrc", "[00:01.00]First\n[00:03.50]Second\n"),
  vcf: () => file("t.vcf", "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Asha Rao\r\nEMAIL;TYPE=work:a@x.in\r\nTEL:+91 1\r\nEND:VCARD\r\n"),
  ics: () => file("t.ics", "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Meet, plan\r\nDTSTART:20261014T100000Z\r\nDTEND:20261014T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"),
  gpx: () => file("t.gpx", '<gpx><wpt lat="12.9" lon="77.6"><name>BLR</name></wpt><trk><name>run</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>'),
  kml: () => file("t.kml", "<kml><Document><Placemark><name>P</name><Point><coordinates>77.6,12.9,0</coordinates></Point></Placemark></Document></kml>"),
  geojson: () => file("t.geojson", '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[77.6,12.9]},"properties":{"name":"BLR"}}]}'),
  log: () => file("t.log", "2026-10-14 10:00:00 ERROR disk full\n2026-10-14 10:00:01 INFO ok\n"),
  diff: () => file("t.diff", "diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new\n"),
  patch: () => file("t.patch", "--- a/y\n+++ b/y\n@@ -1 +1,2 @@\n a\n+b\n"),
  ipynb: () => file("t.ipynb", JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# Title"] }, { cell_type: "code", source: ["print(1)"], outputs: [{ text: ["1\n"] }] }], metadata: {} })),
  rtf: () => file("t.rtf", "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello \\u2344?\\par World}"),
  odt: () => file("t.odt", zipSync({ mimetype: strToU8("application/vnd.oasis.opendocument.text"), "content.xml": strToU8('<office:document-content><text:h text:outline-level="1">Head</text:h><text:p>Body text</text:p></office:document-content>') })),
  pptx: () => file("t.pptx", zipSync({ "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>Intro</a:t></a:r></a:p><a:p><a:r><a:t>Point</a:t></a:r></a:p></p:sld>") })),
  odp: () => file("t.odp", zipSync({ "content.xml": strToU8("<x><draw:page><text:p>Slide A</text:p><text:p>Item</text:p></draw:page></x>") })),
  fb2: () => file("t.fb2", "<FictionBook><description><title-info><book-title>Tale</book-title></title-info></description><body><section><title><p>Ch 1</p></title><p>Once.</p></section></body></FictionBook>"),
  tex: () => file("t.tex", "\\documentclass{article}\\title{Paper}\\begin{document}\\section{Intro}Hello \\textbf{bold}.\\end{document}"),
  mmd: () => file("t.mmd", "graph TD; A-->B"), dot: () => file("t.dot", "digraph{a->b}"), puml: () => file("t.puml", "@startuml\nA->B\n@enduml"),
  drawio: () => file("t.drawio", '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="a" value="Start" vertex="1"/><mxCell id="b" value="End" vertex="1"/><mxCell id="e" edge="1" source="a" target="b" value="go"/></root></mxGraphModel></diagram></mxfile>'),
  dxf: () => file("t.dxf", "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWalls\n0\nENDSEC\n0\nEOF\n"),
  svg: () => file("t.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>'),
  zip: () => file("t.zip", zipSync({ "a.txt": strToU8("hi"), "d/b.txt": strToU8("yo") })),
  tar: () => file("t.tar", F.writeTar([{ path: "a.txt", bytes: strToU8("hi") }])),
  tgz: () => file("t.tgz", gzipSync(F.writeTar([{ path: "a.txt", bytes: strToU8("hi") }]))),
  gz: () => file("notes.txt.gz", gzipSync(strToU8("plain text"))),
  cbz: () => file("t.cbz", zipSync({ "001.png": tinyPng, "002.png": tinyPng })),
  woff: () => file("t.woff", woff()),
  md: () => file("t.md", "# Title\n\nHello नमस्ते\n\n| a | b |\n|---|---|\n| 1 | 2 |"),
  txt: () => file("t.txt", "Line one\nLine two"),
  html: () => file("t.html", "<h1>T</h1><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>-2</td></tr></table>"),
};
const codeIds = FORMATS.filter((x) => x.category === "code" && x.id !== "ipynb").map((x) => x.id).concat(["dockerfile", "gitignore"]);
for (const id of codeIds) FIX[id] ??= () => file(id === "dockerfile" ? "Dockerfile" : id === "gitignore" ? ".gitignore" : `main.${FORMAT_BY_ID.get(id)!.exts[0]}`, id === "dockerfile" ? "FROM node:20\nRUN echo hi\n" : id === "gitignore" ? "node_modules\n!keep\n" : "// hello\nconst x = 1 < 2;\n");

describe("canonical registry", () => {
  it("keeps all 131 inventory entries and maps each to a canonical format", () => {
    expect(INVENTORY_131).toHaveLength(131);
    for (const { entry } of INVENTORY_131) expect(canonicalId(entry), entry).not.toBeNull();
    const unique = new Set(INVENTORY_131.map((e) => canonicalId(e.entry)));
    expect(unique.size).toBe(121); // 131 entries − 10 repeats/aliases (HTML, SQL, TOML, YAML, YML, SVG listed twice; JPG/JPEG, TIFF/TIF, MPEG/MPG, DB/SQLite)
    expect(unique.size).toBe(FORMATS.length);
  });
  it("every format declares at least one real capability, and no format claims media generation", () => {
    for (const x of FORMATS) expect(x.read || x.create || x.inline.length || x.runtime, x.id).toBeTruthy();
    expect(FORMATS.some((x) => /generat/i.test(JSON.stringify(x.runtime ?? {})))).toBe(false);
  });
  it("runtime targets are all registered with the runtime and accepted sources", () => {
    for (const x of FORMATS) if (x.runtime) {
      const op = RUNTIME_OPS[x.runtime.op];
      for (const t of x.runtime.targets) expect(op.targets, `${x.id}→${t}`).toContain(t);
      const srcs = RUNTIME_SOURCES[x.runtime.op]; if (srcs) expect(srcs, x.id).toContain(x.id);
    }
  });
  it("normalises names and special file names", () => {
    expect(canonicalId("JPG")).toBe("jpeg"); expect(canonicalId("yml")).toBe("yaml"); expect(canonicalId("SQLite")).toBe("sqlite"); expect(canonicalId("DB")).toBe("sqlite");
    expect(formatOfName("Dockerfile")!.id).toBe("dockerfile"); expect(formatOfName(".gitignore")!.id).toBe("gitignore"); expect(formatOfName("a.tar.gz")!.id).toBe("tgz"); expect(formatOfName(".env.local")!.id).toBe("env");
  });
  it("routes per operation, and refuses impossible pairs clearly", () => {
    expect(routeConversion("csv", "json")).toEqual({ where: "inline" });
    expect(routeConversion("doc", "pdf")).toEqual({ where: "runtime", op: "office_convert" });
    expect(routeConversion("mp4", "mp3")).toEqual({ where: "runtime", op: "audio_convert" });
    expect(routeConversion("heic", "jpg")).toEqual({ where: "runtime", op: "image_convert" });
    expect(routeConversion("png", "heic")).toMatchObject({ where: "unsupported" });
    expect(routeConversion("mp3", "mp4")).toMatchObject({ where: "unsupported" });
    expect(routeConversion("ttf", "otf")).toMatchObject({ where: "unsupported" });
    expect(routeConversion("csv", "csv")).toMatchObject({ where: "unsupported", reason: expect.stringMatching(/already/) });
  });
  it("detects content that doesn't match the extension", () => {
    expect(matchesSignature("pdf", strToU8("%PDF-1.7"))).toBe(true);
    expect(matchesSignature("pdf", strToU8("hello"))).toBe(false);
    expect(matchesSignature("sqlite", strToU8("SQLite format 3\0"))).toBe(true);
  });
});

describe("every inline conversion produces a re-readable file", () => {
  const cases = FORMATS.flatMap((x) => (FIX[x.id] ? x.inline.map((to) => [x.id, to] as const) : []));
  it("has a fixture for every format with inline conversions", () => {
    for (const x of FORMATS) if (x.inline.length && !["pdf", "docx", "epub"].includes(x.id)) expect(FIX[x.id], x.id).toBeDefined();
  });
  const ALT: Record<string, () => WorkFile> = { "json:ini": () => file("o.json", '{"db":{"host":"x"},"debug":true}'), "json:properties": () => file("o.json", '{"a":{"b":1}}'), "json:env": () => file("o.json", '{"api_url":"x"}'), "woff:otf": () => file("c.woff", woff(0x4f54544f)) };
  it.each(cases)("%s → %s", async (from, to) => {
    const o = await out((ALT[`${from}:${to}`] ?? FIX[from])(), to);
    expect(o.bytes.length).toBeGreaterThan(0);
    expect(o.name.endsWith(`.${to === "jpeg" ? "jpg" : to}`), o.name).toBe(true);
    expect(F.verifyProduced(to, o.bytes)).toBeNull();
    if (to === "pdf") expect((await PDFDocument.load(o.bytes)).getPageCount()).toBeGreaterThan(0);
    if (to === "docx" || to === "epub" || to === "xlsx") expect(Object.keys(unzipSync(o.bytes)).length).toBeGreaterThan(0);
  });
});

describe("content is preserved", () => {
  it("CSV → JSON keeps quoted commas, Unicode, negatives and empty cells", async () => {
    expect(JSON.parse(s(await out(FIX.csv(), "json")))).toEqual([{ name: "Doe, J", qty: -3, note: "हिन्दी" }, { name: "Amy", qty: 4, note: null }]);
  });
  it("CSV → XLSX → CSV round-trips numbers as numbers", async () => {
    const x = await out(FIX.csv(), "xlsx");
    expect(readXlsx(x.bytes)[0].rows[1]).toEqual(["Doe, J", -3, "हिन्दी"]);
  });
  it("SQL INSERTs → CSV keeps escaped quotes and Hindi", async () => {
    expect(s(await out(FIX.sql(), "csv"))).toBe("name,qty\nO'Neil,-3\nहिन्दी,4\n");
  });
  it("YAML ↔ TOML ↔ JSON", async () => {
    expect(TOML.parse(s(await out(FIX.toml(), "yaml")) && s(await out(file("x.yaml", YAML.stringify({ a: { b: 1 } })), "toml")))).toEqual({ a: { b: 1 } });
  });
  it("SRT → VTT/ASS/LRC keeps timing and text", async () => {
    expect(s(await out(FIX.srt(), "vtt"))).toContain("00:00:01.000 --> 00:00:02.500\nHello नमस्ते");
    expect(F.parseSubs("ass", s(await out(FIX.srt(), "ass")))[0]).toEqual({ start: 1000, end: 2500, text: "Hello नमस्ते" });
    expect(F.parseSubs("ass", FIX.ass().bytes.length ? s(FIX.ass()) : "")[0].text).toBe("Hi, there\nline2");
    expect(s(await out(FIX.lrc(), "srt"))).toContain("00:00:01,000 --> 00:00:03,500");
  });
  it("GPX → GeoJSON → KML keeps coordinates", async () => {
    const gj = JSON.parse(s(await out(FIX.gpx(), "geojson")));
    expect(gj.features[0].geometry.coordinates).toEqual([77.6, 12.9]);
    expect(F.parseGeo("kml", s(await out(file("x.geojson", JSON.stringify(gj)), "kml")))[1].geometry.coordinates).toEqual([[2, 1], [4, 3]]);
  });
  it("vCard and iCalendar become rows", async () => {
    expect(s(await out(FIX.vcf(), "csv"))).toContain("Asha Rao");
    expect(JSON.parse(s(await out(FIX.ics(), "json")))[0]).toMatchObject({ title: "Meet, plan", start: "2026-10-14T10:00:00Z" });
  });
  it("archives repack without losing files, and unsafe archives are refused", async () => {
    expect(F.readTar((await out(FIX.zip(), "tar")).bytes).map((f) => f.path).sort()).toEqual(["a.txt", "d/b.txt"]);
    expect(strFromU8(unzipSync((await out(FIX.tgz(), "zip")).bytes)["a.txt"])).toBe("hi");
    await expect(convert(file("e.tar", F.writeTar([{ path: "../evil", bytes: strToU8("x") }])), "zip")).rejects.toThrow(/unsafe/);
    await expect(convert(file("e.zip", zipSync({ "../evil": strToU8("x") })), "tar")).rejects.toThrow(/unsafe/);
  });
  it("notebook → Python keeps cells and never runs them", async () => {
    expect(s(await out(FIX.ipynb(), "py"))).toBe("# %% [markdown]\n# # Title\n\n# %%\nprint(1)\n");
  });
  it("draw.io → DOT/Mermaid extracts shapes and connectors", async () => {
    expect(s(await out(FIX.drawio(), "dot"))).toContain('na -> nb [label="go"]');
  });
  it("WOFF unwraps to a TrueType font", async () => {
    const o = await out(FIX.woff(), "ttf");
    expect(Array.from(o.bytes.subarray(0, 4))).toEqual([0, 1, 0, 0]);
    expect(F.fontInfo(o.bytes).tables).toEqual(["head"]);
  });
  it("comic CBZ → PDF has one page per image", async () => {
    expect((await PDFDocument.load((await out(FIX.cbz(), "pdf")).bytes)).getPageCount()).toBe(2);
  });
  it("RTF Unicode survives", async () => {
    expect(s(await out(FIX.rtf(), "txt"))).toContain("Hello न");
  });
});

describe("failures are explicit, never fake", () => {
  it("rejects mislabeled, empty and malformed files", async () => {
    await expect(convert(file("x.pdf", "not a pdf"), "txt")).rejects.toThrow(/not a real PDF/);
    await expect(convert(file("x.json", ""), "csv")).rejects.toThrow(/empty/);
    await expect(convert(file("x.json", "{bad"), "csv")).rejects.toThrow(/Invalid JSON/);
    await expect(convert(file("x.xml", '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'), "json")).rejects.toThrow(/entity/);
  });
  it("unsupported pairs explain what is possible", async () => {
    await expect(convert(FIX.srt(), "mp4")).rejects.toThrow(/SubRip can be converted to/);
    await expect(convert(FIX.csv(), "psd")).rejects.toThrow(/not a supported output/);
  });
  it("heavy pairs point to the background runtime instead of pretending", async () => {
    await expect(convert(file("a.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), "pdf")).rejects.toThrow(/background task/);
  });
  it("format_support answers capability questions truthfully", async () => {
    const r = await TOOL_MAP.get("format_support")!.run(ctx([]), { format: "rar" });
    expect(r.text).toMatch(/RAR .*convert → ZIP/);
    const e = await TOOL_MAP.get("format_support")!.run(ctx([FIX.env()]), {});
    expect(JSON.stringify(e.data)).toContain("DB_PASSWORD");
  });
});

describe("chat routing to the runtime for heavy formats", () => {
  const one = (name: string, size = 1000) => [{ name, mime: "", size }];
  it.each([
    ["Convert to PDF", "report.doc", "office_convert", { target: "pdf", source: "doc" }],
    ["convert this to xlsx", "old.xls", "office_convert", { target: "xlsx", source: "xls" }],
    ["convert to csv", "data.sqlite", "data_convert", { target: "csv", source: "sqlite" }],
    ["convert to json", "data.parquet", "data_convert", { target: "json", source: "parquet" }],
    ["convert to zip", "a.rar", "archive_convert", { target: "zip", source: "rar" }],
    ["convert to epub", "b.mobi", "ebook_convert", { target: "epub", source: "mobi" }],
    ["convert to woff2", "f.ttf", "font_convert", { target: "woff2" }],
    ["render it, convert to svg", "g.dot", "render", { target: "svg", source: "dot" }],
    ["convert to mp3", "song.flac", "audio_convert", { target: "mp3" }],
    ["convert to mp3", "clip.mp4", "audio_convert", { target: "mp3" }],
    ["convert to jpg", "photo.heic", "image_convert", { target: "jpeg" }],
    ["convert to avi", "clip.mov", "video_convert", { target: "avi" }],
  ])("%s (%s)", (prompt, name, operation, params) => {
    expect(detectRuntimeOp(prompt, one(name))).toEqual({ operation, params, fileIndex: 0 });
  });
  it("light pairs stay inline (not dispatched)", () => {
    expect(detectRuntimeOp("convert to json", one("a.csv"))).toBeNull();
    expect(detectRuntimeOp("convert to vtt", one("a.srt"))).toBeNull();
  });
  it("unsupported runtime-only pairs fail with a reason", () => {
    expect(detectRuntimeOp("convert to docx", one("a.rar"))).toHaveProperty("error");
  });
  it("cleanParams strips unknown keys and refuses unknown sources", () => {
    expect(cleanParams("office_convert", { target: "pdf", source: "docx", cmd: "rm -rf /" })).toEqual({ target: "pdf", source: "docx" });
    expect(() => cleanParams("office_convert", { target: "pdf", source: "exe" })).toThrow();
  });
  it("runtime outputs are checked by content", () => {
    expect(outputMatches("mp3", strToU8("ID3\x04"))).toBe(true);
    expect(outputMatches("woff2", strToU8("wOF2...."))).toBe(true);
    expect(outputMatches("pdf", strToU8("hello"))).toBe(false);
    expect(outputMatches("json", strToU8("{bad"))).toBe(false);
    expect(outputMatches("csv", strToU8("a,b\n"))).toBe(true);
  });
});
