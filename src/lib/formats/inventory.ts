// Canonical file-format registry: the single source of truth for what VISION can do with each format.
// Pure and shared by the agent tools, chat routing and tests. Capabilities are declared only when a real
// implementation exists (inline = Cloudflare Worker code in ./convert.ts; runtime = GitHub Actions op).

/** The original 131-entry inventory, in order, aliases and duplicates kept on purpose. */
export const INVENTORY_131: readonly { group: string; entry: string }[] = ([
  ["Documents", "PDF DOC DOCX TXT MD RTF ODT HTML EPUB TEX"],
  ["Spreadsheets/data", "XLS XLSX CSV ODS TSV JSON JSONL XML YAML TOML SQL DB SQLite"],
  ["Presentations", "PPT PPTX ODP"],
  ["Code/development", "CSS JS JSX TS TSX MJS CJS PY JAVA C CPP H HPP CS GO RS PHP RB SWIFT KT KTS SH BAT PS1 IPYNB ENV INI CFG CONF PROPERTIES DOCKERFILE GITIGNORE HTML SQL TOML YAML YML"],
  ["Images", "PNG JPG JPEG WEBP BMP TIFF TIF GIF ICO SVG AVIF HEIC"],
  ["Audio", "WAV MP3 FLAC OGG M4A AAC WMA OPUS AIFF"],
  ["Video", "MP4 WEBM MOV MKV AVI WMV M4V MPEG MPG 3GP"],
  ["Archives", "ZIP TAR GZ TGZ 7Z RAR"],
  ["Subtitles/transcripts", "SRT VTT ASS SSA LRC"],
  ["E-books/publishing", "MOBI AZW3 FB2 CBZ CBR"],
  ["Graphics/diagrams/design", "SVG MMD DOT DRAWIO PUML DXF"],
  ["Fonts", "TTF OTF WOFF WOFF2"],
  ["Other technical", "VCF ICS KML GPX GEOJSON SHP PARQUET AVRO LOG DIFF PATCH"],
] as const).flatMap(([group, list]) => list.split(" ").map((entry) => ({ group, entry })));

export type RuntimeOpName = "image_convert" | "video_convert" | "audio_convert" | "office_convert" | "data_convert" | "archive_convert" | "ebook_convert" | "font_convert" | "render";
export type Category = "document" | "spreadsheet" | "data" | "presentation" | "code" | "config" | "image" | "audio" | "video" | "archive" | "subtitle" | "ebook" | "diagram" | "font" | "geo" | "contact" | "calendar" | "log";

export type Format = {
  id: string; name: string; exts: string[]; category: Category; mime: string;
  /** Read text/structure out of the file (inline). */
  read: boolean;
  /** Write a new file of this format from content/structured data (inline). */
  create: boolean;
  /** Targets converted in the Worker. */
  inline: string[];
  /** Targets converted on the runtime, with the operation that does it. */
  runtime?: { op: RuntimeOpName; targets: string[] };
  /** Honest notes: lossy steps, limits, why something is not offered. */
  notes?: string;
};

const TEXTDOC = ["pdf", "docx", "html", "md", "txt", "epub"];
const TABLE = ["csv", "tsv", "json", "jsonl", "xml", "yaml", "toml", "sql", "xlsx", "ods", "html", "md", "pdf", "docx"];
const TREE = ["json", "yaml", "toml", "xml"];
const CODE_OUT = ["txt", "md", "html", "pdf", "docx"];
const SUBS = ["srt", "vtt", "ass", "ssa", "lrc", "txt", "json"];
const GEO = ["geojson", "kml", "gpx", "csv"];
const IMG_T = ["png", "jpeg", "webp", "gif", "bmp", "tiff", "ico", "avif", "pdf"];
const AUD_T = ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "aiff", "wma"];
const VID_T = ["mp4", "webm", "mov", "mkv", "m4v", "avi", "wmv", "mpeg", "3gp"];
const without = (a: string[], x: string) => a.filter((t) => t !== x);

const f = (id: string, name: string, exts: string[], category: Category, mime: string, o: Partial<Format> = {}): Format =>
  ({ id, name, exts, category, mime, read: true, create: false, inline: [], ...o });
const code = (id: string, name: string, exts: string[], mime = "text/plain") => f(id, name, exts, "code", mime, { create: true, inline: CODE_OUT, notes: "Treated as text; never executed." });
const img = (id: string, name: string, exts: string[], mime: string) => f(id, name, exts, "image", mime, { read: true, runtime: { op: "image_convert", targets: without(IMG_T, id) }, notes: "Pixel conversion on the runtime (Pillow). Reading = OCR/description; no image generation." });
const aud = (id: string, name: string, exts: string[], mime: string) => f(id, name, exts, "audio", mime, { runtime: { op: "audio_convert", targets: without(AUD_T, id) }, notes: "Decoded and re-encoded with FFmpeg; lossy targets lose quality. Reading = speech-to-text." });
const vid = (id: string, name: string, exts: string[], mime: string) => f(id, name, exts, "video", mime, { read: false, runtime: { op: "video_convert", targets: without(VID_T, id) }, notes: "Transcoded with FFmpeg (max 15 min); audio can be extracted via audio_convert. No video generation." });

export const FORMATS: Format[] = [
  // Documents
  f("pdf", "PDF", ["pdf"], "document", "application/pdf", { create: true, inline: ["txt", "md", "html", "docx", "epub"], notes: "Text-only extraction when converting from PDF; layout/images are not kept. Built-in PDF font cannot draw non-Latin scripts — reported, never silently dropped." }),
  f("doc", "Word 97-2003", ["doc"], "document", "application/msword", { read: false, runtime: { op: "office_convert", targets: ["pdf", "docx", "odt", "rtf", "txt", "html"] } }),
  f("docx", "Word", ["docx"], "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", { create: true, inline: without(TEXTDOC, "docx"), runtime: { op: "office_convert", targets: ["doc", "odt", "rtf"] } }),
  f("txt", "Plain text", ["txt", "text"], "document", "text/plain", { create: true, inline: without(TEXTDOC, "txt") }),
  f("md", "Markdown", ["md", "markdown"], "document", "text/markdown", { create: true, inline: without(TEXTDOC, "md") }),
  f("rtf", "Rich Text", ["rtf"], "document", "application/rtf", { create: true, inline: TEXTDOC, runtime: { op: "office_convert", targets: ["doc", "odt"] }, notes: "Inline reading keeps text only; formatting kept via the runtime." }),
  f("odt", "OpenDocument Text", ["odt"], "document", "application/vnd.oasis.opendocument.text", { inline: TEXTDOC, runtime: { op: "office_convert", targets: ["doc", "rtf"] } }),
  f("html", "HTML", ["html", "htm"], "document", "text/html", { create: true, inline: [...without(TEXTDOC, "html"), "csv", "xlsx"], notes: "Scripts are never run; tables can be extracted." }),
  f("epub", "EPUB", ["epub"], "ebook", "application/epub+zip", { create: true, inline: ["txt", "md", "html", "pdf", "docx"], runtime: { op: "ebook_convert", targets: ["mobi", "azw3", "fb2"] } }),
  f("tex", "LaTeX", ["tex", "latex"], "document", "application/x-tex", { create: true, inline: ["txt", "md"], runtime: { op: "render", targets: ["pdf"] }, notes: "Compiled with pdflatex, shell-escape disabled." }),
  // Spreadsheets / data
  f("xls", "Excel 97-2003", ["xls"], "spreadsheet", "application/vnd.ms-excel", { read: false, runtime: { op: "office_convert", targets: ["xlsx", "ods", "csv", "pdf", "html"] } }),
  f("xlsx", "Excel", ["xlsx", "xlsm"], "spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { create: true, inline: without(TABLE, "xlsx"), runtime: { op: "office_convert", targets: ["xls"] }, notes: "Values only; formulas, charts and styles are not kept inline." }),
  f("csv", "CSV", ["csv"], "spreadsheet", "text/csv", { create: true, inline: without(TABLE, "csv"), runtime: { op: "data_convert", targets: ["parquet", "avro", "sqlite"] } }),
  f("ods", "OpenDocument Spreadsheet", ["ods"], "spreadsheet", "application/vnd.oasis.opendocument.spreadsheet", { create: true, inline: without(TABLE, "ods"), runtime: { op: "office_convert", targets: ["xls"] } }),
  f("tsv", "TSV", ["tsv", "tab"], "spreadsheet", "text/tab-separated-values", { create: true, inline: without(TABLE, "tsv") }),
  f("json", "JSON", ["json"], "data", "application/json", { create: true, inline: [...without(TABLE, "json"), "ini", "properties", "env"], runtime: { op: "data_convert", targets: ["parquet", "avro", "sqlite"] } }),
  f("jsonl", "JSON Lines", ["jsonl", "ndjson"], "data", "application/x-ndjson", { create: true, inline: without(TABLE, "jsonl") }),
  f("xml", "XML", ["xml"], "data", "application/xml", { create: true, inline: without([...TABLE, "yaml", "toml"], "xml").filter((t) => t !== "jsonl"), notes: "External entities are never resolved." }),
  f("yaml", "YAML", ["yaml", "yml"], "config", "application/yaml", { create: true, inline: without([...TABLE, ...TREE], "yaml") }),
  f("toml", "TOML", ["toml"], "config", "application/toml", { create: true, inline: without([...TREE, "csv", "xlsx", "ini"], "toml") }),
  f("sql", "SQL", ["sql"], "data", "application/sql", { create: true, inline: ["csv", "json", "xlsx", "txt", "md", "html", "pdf"], notes: "INSERT statements are parsed into tables; SQL is never executed." }),
  f("sqlite", "SQLite database", ["sqlite", "sqlite3", "db"], "data", "application/vnd.sqlite3", { read: false, runtime: { op: "data_convert", targets: ["csv", "json", "parquet", "avro"] }, notes: "Opened read-only on the runtime; DB entries are verified by the SQLite header." }),
  // Presentations
  f("ppt", "PowerPoint 97-2003", ["ppt"], "presentation", "application/vnd.ms-powerpoint", { read: false, runtime: { op: "office_convert", targets: ["pptx", "odp", "pdf"] } }),
  f("pptx", "PowerPoint", ["pptx"], "presentation", "application/vnd.openxmlformats-officedocument.presentationml.presentation", { inline: ["txt", "md", "html", "docx"], runtime: { op: "office_convert", targets: ["pdf", "odp", "ppt"] }, notes: "Inline conversion extracts slide text." }),
  f("odp", "OpenDocument Presentation", ["odp"], "presentation", "application/vnd.oasis.opendocument.presentation", { inline: ["txt", "md", "html", "docx"], runtime: { op: "office_convert", targets: ["pdf", "pptx", "ppt"] } }),
  // Code & configuration
  code("css", "CSS", ["css"], "text/css"), code("js", "JavaScript", ["js"], "text/javascript"), code("jsx", "JSX", ["jsx"]), code("ts", "TypeScript", ["ts"]), code("tsx", "TSX", ["tsx"]),
  code("mjs", "ES module", ["mjs"], "text/javascript"), code("cjs", "CommonJS", ["cjs"], "text/javascript"), code("py", "Python", ["py"], "text/x-python"), code("java", "Java", ["java"]),
  code("c", "C", ["c"]), code("cpp", "C++", ["cpp", "cc", "cxx"]), code("h", "C header", ["h"]), code("hpp", "C++ header", ["hpp", "hh"]), code("cs", "C#", ["cs"]), code("go", "Go", ["go"]),
  code("rs", "Rust", ["rs"]), code("php", "PHP", ["php"]), code("rb", "Ruby", ["rb"]), code("swift", "Swift", ["swift"]), code("kt", "Kotlin", ["kt"]), code("kts", "Kotlin script", ["kts"]),
  code("sh", "Shell script", ["sh", "bash"], "application/x-sh"), code("bat", "Batch file", ["bat", "cmd"]), code("ps1", "PowerShell", ["ps1"]),
  f("ipynb", "Jupyter notebook", ["ipynb"], "code", "application/x-ipynb+json", { create: true, inline: ["py", "md", "html", "txt", "pdf", "json"], notes: "Cells are converted, never executed." }),
  f("env", "Env file", ["env"], "config", "text/plain", { create: true, inline: ["json", "yaml", "properties", "ini", "toml"], notes: "Values that look like secrets are flagged when inspected." }),
  f("ini", "INI", ["ini"], "config", "text/plain", { create: true, inline: ["json", "yaml", "toml", "properties", "env"] }),
  f("cfg", "CFG config", ["cfg"], "config", "text/plain", { create: true, inline: ["json", "yaml", "toml", "ini"], notes: "Parsed as INI-style sections." }),
  f("conf", "CONF config", ["conf"], "config", "text/plain", { create: true, inline: ["json", "yaml", "toml", "ini"], notes: "Parsed as INI-style key=value; other syntaxes are kept as text." }),
  f("properties", "Java properties", ["properties"], "config", "text/plain", { create: true, inline: ["json", "yaml", "env", "ini", "toml"] }),
  f("dockerfile", "Dockerfile", ["dockerfile"], "config", "text/plain", { create: true, inline: [...CODE_OUT, "json"], notes: "Instructions are listed, never built." }),
  f("gitignore", ".gitignore", ["gitignore"], "config", "text/plain", { create: true, inline: [...CODE_OUT, "json"] }),
  // Images
  img("png", "PNG", ["png"], "image/png"), img("jpeg", "JPEG", ["jpg", "jpeg"], "image/jpeg"), img("webp", "WebP", ["webp"], "image/webp"), img("bmp", "BMP", ["bmp"], "image/bmp"),
  img("tiff", "TIFF", ["tiff", "tif"], "image/tiff"), img("gif", "GIF", ["gif"], "image/gif"), img("ico", "ICO", ["ico"], "image/x-icon"), img("avif", "AVIF", ["avif"], "image/avif"),
  { ...img("heic", "HEIC", ["heic", "heif"], "image/heic"), notes: "Decoded on the runtime (libheif); HEIC is not written as an output." },
  f("svg", "SVG", ["svg"], "image", "image/svg+xml", { create: true, inline: ["txt"], runtime: { op: "render", targets: ["png", "pdf"] }, notes: "Scripts/external references are reported on inspect; rendered with CairoSVG (no network)." }),
  // Audio
  aud("wav", "WAV", ["wav"], "audio/wav"), aud("mp3", "MP3", ["mp3"], "audio/mpeg"), aud("flac", "FLAC", ["flac"], "audio/flac"), aud("ogg", "Ogg Vorbis", ["ogg", "oga"], "audio/ogg"),
  aud("m4a", "M4A", ["m4a"], "audio/mp4"), aud("aac", "AAC", ["aac"], "audio/aac"), aud("wma", "WMA", ["wma"], "audio/x-ms-wma"), aud("opus", "Opus", ["opus"], "audio/opus"), aud("aiff", "AIFF", ["aiff", "aif"], "audio/aiff"),
  // Video
  vid("mp4", "MP4", ["mp4"], "video/mp4"), vid("webm", "WebM", ["webm"], "video/webm"), vid("mov", "QuickTime", ["mov"], "video/quicktime"), vid("mkv", "Matroska", ["mkv"], "video/x-matroska"),
  vid("avi", "AVI", ["avi"], "video/x-msvideo"), vid("wmv", "WMV", ["wmv"], "video/x-ms-wmv"), vid("m4v", "M4V", ["m4v"], "video/x-m4v"), vid("mpeg", "MPEG", ["mpeg", "mpg"], "video/mpeg"), vid("3gp", "3GP", ["3gp"], "video/3gpp"),
  // Archives
  f("zip", "ZIP", ["zip"], "archive", "application/zip", { create: true, inline: ["tar", "tgz", "txt"], runtime: { op: "archive_convert", targets: ["7z"] }, notes: "Listing/extraction checks paths, links, sizes and entry counts (ZIP-slip and bomb safe)." }),
  f("tar", "TAR", ["tar"], "archive", "application/x-tar", { create: true, inline: ["zip", "tgz", "txt"], runtime: { op: "archive_convert", targets: ["7z"] } }),
  f("gz", "Gzip", ["gz", "gzip"], "archive", "application/gzip", { create: true, inline: ["zip", "txt"], notes: "Decompressed with a size ceiling; gzip of a TAR is handled as TGZ." }),
  f("tgz", "Tar.gz", ["tgz", "tar.gz"], "archive", "application/gzip", { create: true, inline: ["zip", "tar", "txt"], runtime: { op: "archive_convert", targets: ["7z"] } }),
  f("7z", "7-Zip", ["7z"], "archive", "application/x-7z-compressed", { read: false, runtime: { op: "archive_convert", targets: ["zip", "tar", "tgz"] }, notes: "Encrypted archives are refused." }),
  f("rar", "RAR", ["rar"], "archive", "application/vnd.rar", { read: false, runtime: { op: "archive_convert", targets: ["zip", "tar", "tgz", "7z"] }, notes: "RAR is read-only (proprietary encoder); encrypted archives are refused." }),
  // Subtitles
  f("srt", "SubRip", ["srt"], "subtitle", "application/x-subrip", { create: true, inline: without(SUBS, "srt") }),
  f("vtt", "WebVTT", ["vtt"], "subtitle", "text/vtt", { create: true, inline: without(SUBS, "vtt") }),
  f("ass", "Advanced SubStation", ["ass"], "subtitle", "text/x-ass", { create: true, inline: without(SUBS, "ass"), notes: "Styling/positioning tags are dropped when converting to other formats." }),
  f("ssa", "SubStation Alpha", ["ssa"], "subtitle", "text/x-ssa", { create: true, inline: without(SUBS, "ssa"), notes: "Styling tags are dropped when converting." }),
  f("lrc", "LRC lyrics", ["lrc"], "subtitle", "text/plain", { create: true, inline: without(SUBS, "lrc"), notes: "LRC has start times only; end times are inferred from the next line." }),
  // E-books
  f("mobi", "Mobipocket", ["mobi", "prc"], "ebook", "application/x-mobipocket-ebook", { read: false, runtime: { op: "ebook_convert", targets: ["epub", "pdf", "txt", "azw3", "docx", "html", "fb2"] }, notes: "DRM-protected books cannot be converted." }),
  f("azw3", "Kindle AZW3", ["azw3", "azw"], "ebook", "application/vnd.amazon.ebook", { read: false, runtime: { op: "ebook_convert", targets: ["epub", "pdf", "txt", "mobi", "docx", "html", "fb2"] }, notes: "DRM-protected books cannot be converted." }),
  f("fb2", "FictionBook", ["fb2"], "ebook", "application/x-fictionbook+xml", { inline: ["txt", "md", "html", "pdf", "docx", "epub"], runtime: { op: "ebook_convert", targets: ["mobi", "azw3"] } }),
  f("cbz", "Comic ZIP", ["cbz"], "ebook", "application/vnd.comicbook+zip", { create: true, inline: ["pdf", "zip"], runtime: { op: "ebook_convert", targets: ["epub"] }, notes: "PDF output embeds JPEG/PNG pages only." }),
  f("cbr", "Comic RAR", ["cbr"], "ebook", "application/vnd.comicbook-rar", { read: false, runtime: { op: "archive_convert", targets: ["cbz", "zip"] } }),
  // Diagrams / design
  f("mmd", "Mermaid", ["mmd", "mermaid"], "diagram", "text/plain", { create: true, inline: ["md", "txt"], runtime: { op: "render", targets: ["svg", "png", "pdf"] } }),
  f("dot", "Graphviz DOT", ["dot", "gv"], "diagram", "text/vnd.graphviz", { create: true, inline: ["txt", "json"], runtime: { op: "render", targets: ["svg", "png", "pdf"] } }),
  f("drawio", "draw.io XML", ["drawio", "dio"], "diagram", "application/vnd.jgraph.mxfile", { inline: ["json", "txt", "dot", "mmd"], notes: "Shapes/edges are extracted (compressed diagrams decoded); no headless draw.io renderer is available, render via the exported DOT/Mermaid." }),
  f("puml", "PlantUML", ["puml", "plantuml", "pu"], "diagram", "text/plain", { create: true, inline: ["txt", "md"], runtime: { op: "render", targets: ["svg", "png", "pdf"] }, notes: "Rendered in PlantUML's sandbox security profile." }),
  f("dxf", "AutoCAD DXF", ["dxf"], "diagram", "image/vnd.dxf", { inline: ["json", "txt"], runtime: { op: "render", targets: ["svg", "png", "pdf"] } }),
  // Fonts
  f("ttf", "TrueType", ["ttf"], "font", "font/ttf", { runtime: { op: "font_convert", targets: ["woff", "woff2"] }, notes: "TTF↔OTF outline conversion is not offered (would alter glyphs)." }),
  f("otf", "OpenType", ["otf"], "font", "font/otf", { runtime: { op: "font_convert", targets: ["woff", "woff2"] } }),
  f("woff", "WOFF", ["woff"], "font", "font/woff", { inline: ["ttf", "otf"], runtime: { op: "font_convert", targets: ["woff2"] }, notes: "Inline unwrap picks TTF or OTF by outline type." }),
  f("woff2", "WOFF2", ["woff2"], "font", "font/woff2", { runtime: { op: "font_convert", targets: ["ttf", "otf", "woff"] } }),
  // Other technical
  f("vcf", "vCard", ["vcf", "vcard"], "contact", "text/vcard", { create: true, inline: ["csv", "json", "xlsx"] }),
  f("ics", "iCalendar", ["ics", "ical"], "calendar", "text/calendar", { create: true, inline: ["csv", "json", "xlsx"] }),
  f("kml", "KML", ["kml"], "geo", "application/vnd.google-earth.kml+xml", { create: true, inline: without(GEO, "kml") }),
  f("gpx", "GPX", ["gpx"], "geo", "application/gpx+xml", { create: true, inline: without(GEO, "gpx") }),
  f("geojson", "GeoJSON", ["geojson"], "geo", "application/geo+json", { create: true, inline: without(GEO, "geojson") }),
  f("shp", "Shapefile (zipped)", ["shp"], "geo", "application/zip", { read: false, runtime: { op: "data_convert", targets: ["geojson"] }, notes: "Send as a .zip containing .shp/.shx/.dbf." }),
  f("parquet", "Apache Parquet", ["parquet"], "data", "application/vnd.apache.parquet", { read: false, runtime: { op: "data_convert", targets: ["csv", "json", "avro", "sqlite"] } }),
  f("avro", "Apache Avro", ["avro"], "data", "application/avro", { read: false, runtime: { op: "data_convert", targets: ["csv", "json", "parquet", "sqlite"] } }),
  f("log", "Log file", ["log"], "log", "text/plain", { create: true, inline: ["csv", "json", "txt", "md"], notes: "Lines are split into time/level/message when recognisable." }),
  f("diff", "Diff", ["diff"], "log", "text/x-diff", { create: true, inline: ["json", "md", "html", "txt", "patch"] }),
  f("patch", "Patch", ["patch"], "log", "text/x-diff", { create: true, inline: ["json", "md", "html", "txt", "diff"], notes: "Patches are summarised, never applied to the server." }),
];

export const FORMAT_BY_ID = new Map(FORMATS.map((x) => [x.id, x]));
const BY_EXT = new Map(FORMATS.flatMap((x) => x.exts.map((e) => [e, x] as const)));
const ALIAS: Record<string, string> = { jpg: "jpeg", tif: "tiff", mpg: "mpeg", yml: "yaml", db: "sqlite", sqlite3: "sqlite", htm: "html", markdown: "md", word: "docx", excel: "xlsx", text: "txt", "tar.gz": "tgz", mermaid: "mmd", plantuml: "puml", graphviz: "dot", "draw.io": "drawio", vcard: "vcf", ical: "ics", gzip: "gz", ndjson: "jsonl" };

/** Normalises a user-facing name/extension to a canonical id ("JPG" → "jpeg", "SQLite" → "sqlite"). */
export function canonicalId(name: string): string | null {
  const k = name.trim().toLowerCase().replace(/^\./, "");
  const id = ALIAS[k] ?? k;
  return FORMAT_BY_ID.has(id) ? id : BY_EXT.get(k)?.id ?? null;
}

/** Format of a file from its name (special names like Dockerfile/.gitignore included). */
export function formatOfName(fileName: string): Format | null {
  const n = (fileName.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (n === "dockerfile" || n.startsWith("dockerfile.") || n.endsWith(".dockerfile")) return FORMAT_BY_ID.get("dockerfile")!;
  if (n === ".gitignore" || n.endsWith(".gitignore")) return FORMAT_BY_ID.get("gitignore")!;
  if (n === ".env" || n.startsWith(".env.") || n.endsWith(".env")) return FORMAT_BY_ID.get("env")!;
  if (n.endsWith(".tar.gz")) return FORMAT_BY_ID.get("tgz")!;
  if (n.endsWith(".drawio.xml") || n.endsWith(".drawio.svg")) return FORMAT_BY_ID.get("drawio")!;
  const e = n.includes(".") ? n.split(".").pop()! : "";
  return BY_EXT.get(e) ?? null;
}

/** Content signatures: the declared format must match the bytes when a signature exists. */
const asc = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, Math.min(e, b.length)));
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
const SIG: Record<string, (b: Uint8Array) => boolean> = {
  pdf: (b) => asc(b, 0, 5) === "%PDF-", png: (b) => b[0] === 0x89 && asc(b, 1, 4) === "PNG", jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => asc(b, 0, 4) === "GIF8", webp: (b) => asc(b, 0, 4) === "RIFF" && asc(b, 8, 12) === "WEBP", bmp: (b) => asc(b, 0, 2) === "BM",
  tiff: (b) => asc(b, 0, 4) === "II*\0" || asc(b, 0, 4) === "MM\0*", ico: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  avif: (b) => asc(b, 4, 8) === "ftyp" && /avi[fs]/.test(asc(b, 8, 32)), heic: (b) => asc(b, 4, 8) === "ftyp" && /hei[cfsx]|mif1|msf1/.test(asc(b, 8, 32)),
  wav: (b) => asc(b, 0, 4) === "RIFF" && asc(b, 8, 12) === "WAVE", flac: (b) => asc(b, 0, 4) === "fLaC", ogg: (b) => asc(b, 0, 4) === "OggS", opus: (b) => asc(b, 0, 4) === "OggS",
  mp3: (b) => asc(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), aiff: (b) => asc(b, 0, 4) === "FORM" && /AIF[FC]/.test(asc(b, 8, 12)),
  aac: (b) => asc(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0), wma: (b) => b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75, wmv: (b) => b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75,
  m4a: (b) => asc(b, 4, 8) === "ftyp", mp4: (b) => asc(b, 4, 8) === "ftyp", m4v: (b) => asc(b, 4, 8) === "ftyp", "3gp": (b) => asc(b, 4, 8) === "ftyp",
  mov: (b) => ["ftyp", "moov", "wide", "mdat", "free"].includes(asc(b, 4, 8)), webm: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3, mkv: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  avi: (b) => asc(b, 0, 4) === "RIFF" && asc(b, 8, 11) === "AVI", mpeg: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && (b[3] === 0xba || b[3] === 0xb3),
  zip: isZip, docx: isZip, xlsx: isZip, pptx: isZip, odt: isZip, ods: isZip, odp: isZip, epub: isZip, cbz: isZip, shp: isZip,
  doc: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0, xls: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0, ppt: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0,
  gz: (b) => b[0] === 0x1f && b[1] === 0x8b, tgz: (b) => b[0] === 0x1f && b[1] === 0x8b, "7z": (b) => asc(b, 0, 6) === "7z\xbc\xaf\x27\x1c", rar: (b) => asc(b, 0, 4) === "Rar!", cbr: (b) => asc(b, 0, 4) === "Rar!",
  tar: (b) => asc(b, 257, 262) === "ustar", sqlite: (b) => asc(b, 0, 15) === "SQLite format 3", parquet: (b) => asc(b, 0, 4) === "PAR1", avro: (b) => asc(b, 0, 3) === "Obj" && b[3] === 1,
  ttf: (b) => (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || asc(b, 0, 4) === "true", otf: (b) => asc(b, 0, 4) === "OTTO", woff: (b) => asc(b, 0, 4) === "wOFF", woff2: (b) => asc(b, 0, 4) === "wOF2",
  rtf: (b) => asc(b, 0, 5) === "{\\rtf", mobi: (b) => asc(b, 60, 68) === "BOOKMOBI", azw3: (b) => asc(b, 60, 68) === "BOOKMOBI",
};
export const hasSignature = (id: string) => id in SIG;
export function matchesSignature(id: string, bytes: Uint8Array): boolean { return SIG[id] ? SIG[id](bytes) : true; }

/** What can be done with a format → target, and where. */
export type Route = { where: "inline" } | { where: "runtime"; op: RuntimeOpName } | { where: "unsupported"; reason: string };
export function routeConversion(from: string, to: string): Route {
  const src = FORMAT_BY_ID.get(from), tgt = canonicalId(to);
  if (!src) return { where: "unsupported", reason: `"${from}" is not a supported format.` };
  if (!tgt) return { where: "unsupported", reason: `"${to.toUpperCase()}" is not a supported output format.` };
  if (tgt === from) return { where: "unsupported", reason: `The file is already ${src.name}.` };
  if (src.inline.includes(tgt)) return { where: "inline" };
  if (src.runtime?.targets.includes(tgt)) return { where: "runtime", op: src.runtime.op };
  // Audio track extraction from a user's video (decode + encode only).
  if (src.category === "video" && FORMAT_BY_ID.get(tgt)?.category === "audio" && tgt !== "wma" && tgt !== "aiff") return { where: "runtime", op: "audio_convert" };
  const all = [...new Set([...src.inline, ...(src.runtime?.targets ?? [])])];
  return { where: "unsupported", reason: all.length ? `${src.name} can be converted to ${all.map((t) => t.toUpperCase()).join(", ")} — not ${tgt.toUpperCase()}.` : `${src.name} files can be read and inspected but not converted.` };
}

export function capabilitySummary(x: Format): string {
  const conv = [...new Set([...x.inline, ...(x.runtime?.targets ?? [])])].map((t) => t.toUpperCase());
  return `${x.name} (.${x.exts.join(", .")}): ${[x.read ? "read/inspect" : "inspect", x.create ? "create" : "", conv.length ? `convert → ${conv.join(", ")}` : ""].filter(Boolean).join("; ")}${x.notes ? `. ${x.notes}` : ""}`;
}
