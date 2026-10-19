// Background runtime (GitHub Actions) operation registry — mirrors runtime/operations.py in Vision-Runtime.
// Pure and shared by server code and tests. Nothing outside this list can be dispatched.

export const MB = 1024 * 1024;
import { FORMAT_BY_ID, formatOfName, routeConversion, canonicalId, matchesSignature } from "@/lib/formats/inventory";
export type RuntimeOpId = "checksum" | "image_convert" | "video_convert" | "audio_convert" | "office_convert" | "data_convert" | "archive_convert" | "ebook_convert" | "font_convert" | "render" | "story_generate" | "prompt_generate";

export type RuntimeOp = { id: RuntimeOpId; label: string; maxInput: number; maxOutput: number; timeoutMs: number; targets?: readonly string[] };

export const RUNTIME_OPS: Record<RuntimeOpId, RuntimeOp> = {
  checksum: { id: "checksum", label: "Checksum", maxInput: 25 * MB, maxOutput: 0, timeoutMs: 5 * 60_000 },
  image_convert: { id: "image_convert", label: "Image conversion", maxInput: 25 * MB, maxOutput: 60 * MB, timeoutMs: 5 * 60_000, targets: ["png", "jpeg", "webp", "gif", "bmp", "tiff", "ico", "avif", "pdf"] },
  video_convert: { id: "video_convert", label: "Video conversion", maxInput: 25 * MB, maxOutput: 100 * MB, timeoutMs: 25 * 60_000, targets: ["mp4", "webm", "mov", "mkv", "m4v", "avi", "wmv", "mpeg", "3gp"] },
  audio_convert: { id: "audio_convert", label: "Audio conversion", maxInput: 25 * MB, maxOutput: 150 * MB, timeoutMs: 20 * 60_000, targets: ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "aiff", "wma"] },
  office_convert: { id: "office_convert", label: "Office document conversion", maxInput: 25 * MB, maxOutput: 60 * MB, timeoutMs: 10 * 60_000, targets: ["pdf", "docx", "doc", "odt", "rtf", "txt", "html", "xlsx", "xls", "ods", "csv", "pptx", "ppt", "odp"] },
  data_convert: { id: "data_convert", label: "Data conversion", maxInput: 25 * MB, maxOutput: 100 * MB, timeoutMs: 10 * 60_000, targets: ["csv", "json", "parquet", "avro", "sqlite", "geojson"] },
  archive_convert: { id: "archive_convert", label: "Archive conversion", maxInput: 25 * MB, maxOutput: 100 * MB, timeoutMs: 10 * 60_000, targets: ["zip", "7z", "tar", "tgz", "cbz"] },
  ebook_convert: { id: "ebook_convert", label: "E-book conversion", maxInput: 25 * MB, maxOutput: 60 * MB, timeoutMs: 15 * 60_000, targets: ["epub", "pdf", "txt", "mobi", "azw3", "fb2", "docx", "html"] },
  font_convert: { id: "font_convert", label: "Font conversion", maxInput: 25 * MB, maxOutput: 30 * MB, timeoutMs: 5 * 60_000, targets: ["ttf", "otf", "woff", "woff2"] },
  render: { id: "render", label: "Diagram/TeX rendering", maxInput: 5 * MB, maxOutput: 30 * MB, timeoutMs: 10 * 60_000, targets: ["svg", "png", "pdf"] },
  // Prompt-only operation (no input file): the runner writes the full story as a Markdown document.
  story_generate: { id: "story_generate", label: "Story generation", maxInput: 0, maxOutput: 5 * MB, timeoutMs: 40 * 60_000 },
  // One prompt or a linked series with locked characters/style; the runner writes prompts.md.
  prompt_generate: { id: "prompt_generate", label: "Prompt generation", maxInput: 0, maxOutput: 5 * MB, timeoutMs: 40 * 60_000 },
};
/** Source formats each runtime op accepts (sent as params.source because the runner sees only bytes). */
export const RUNTIME_SOURCES: Partial<Record<RuntimeOpId, readonly string[]>> = {
  office_convert: ["doc", "docx", "odt", "rtf", "txt", "html", "xls", "xlsx", "ods", "csv", "tsv", "ppt", "pptx", "odp", "md"],
  data_convert: ["sqlite", "db", "parquet", "avro", "csv", "json", "shp"],
  archive_convert: ["7z", "rar", "tar", "gz", "tgz", "zip", "cbr", "cbz"],
  ebook_convert: ["mobi", "azw3", "fb2", "epub", "cbz", "cbr", "docx", "html", "txt", "md", "rtf", "odt"],
  render: ["dot", "mmd", "puml", "dxf", "tex", "svg"],
};

export const RUNTIME_LIMITS = {
  perUserActive: 2,
  globalActive: 6,
  queueGraceMs: 10 * 60_000, // time allowed to wait for a free runner before TIMED_OUT
  githubCheckEveryMs: 30_000,
  /** Files at or above this size get hashed on the runner instead of inline. */
  inlineChecksumMax: 10 * MB,
};

export const isRuntimeOp = (v: unknown): v is RuntimeOpId => typeof v === "string" && v in RUNTIME_OPS;

const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|ico)$/i;
const VID_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|3gp)$/i;
export const isImageFile = (name: string, mime: string) => mime.startsWith("image/") || IMG_EXT.test(name);
export const isVideoFile = (name: string, mime: string) => mime.startsWith("video/") || VID_EXT.test(name);

function sourceFormat(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return e === "jpg" ? "jpeg" : e === "tif" ? "tiff" : e;
}

/** Picks the target format named in the prompt (e.g. "convert to webp", "as JPG"). */
export function targetFormat(prompt: string, allowed: readonly string[]): string | null {
  const p = prompt.toLowerCase();
  const m = p.match(/\b(?:to|into|as|in)\s+(?:an?\s+)?\.?(png|jpe?g|webp|gif|bmp|tiff?|ico|mp4|webm|mov|mkv)\b/) ?? p.match(/\b(png|jpe?g|webp|gif|bmp|tiff?|ico|mp4|webm|mov|mkv)\s+(?:format|file|version)\b/);
  if (!m) return null;
  const t = m[1] === "jpg" ? "jpeg" : m[1] === "tif" ? "tiff" : m[1];
  return allowed.includes(t) ? t : null;
}

const FORMAT_WORD = /\b(?:to|into|as|make it|make this)\s+(?:an?\s+)?\.?([a-z0-9]{2,5})\b/;
const BARE_FORMAT = /^\s*(?:to\s+|as\s+|into\s+)?\.?([a-z0-9]{2,5})(?:\s+(?:format|file|please))?\s*[.!]?\s*$/;
/** The format word a request names ("convert to webp", "as .mp3", "make it a gif", or just "png"). */
export function requestedFormatWord(prompt: string): string | undefined {
  const p = prompt.toLowerCase();
  return p.match(FORMAT_WORD)?.[1] ?? (BARE_FORMAT.test(p) && canonicalId(p.match(BARE_FORMAT)![1]) ? p.match(BARE_FORMAT)![1] : undefined);
}
/** True when a message asks to change a file's format (browser-safe; used to keep attached photos as files). */
export function isConversionRequest(prompt: string): boolean {
  const p = prompt.toLowerCase();
  if (/\b(convert|conversion|transcode|re-?encode)\b/.test(p)) return true;
  if (/\b(change|turn|save|export|make|format)\b/.test(p) && !!requestedFormatWord(p) && !!canonicalId(requestedFormatWord(p)!)) return true;
  if (/\bextract\b.*\baudio\b/.test(p)) return true;
  const bare = p.match(BARE_FORMAT)?.[1];
  return !!bare && !!canonicalId(bare);
}

export type RuntimeRequest = { operation: RuntimeOpId; params: Record<string, unknown>; fileIndex: number };

/** Decides whether a chat request with attachments is a registered background job. Returns null for anything else. */
export function detectRuntimeOp(prompt: string, files: { name: string; mime: string; size: number }[]): RuntimeRequest | { error: string } | null {
  if (files.length !== 1) return null;
  const f = files[0];
  const p = prompt.toLowerCase();
  const wantsConvert = isConversionRequest(prompt);
  if (wantsConvert && (isImageFile(f.name, f.mime) || isVideoFile(f.name, f.mime))) {
    const video = isVideoFile(f.name, f.mime);
    const op = RUNTIME_OPS[video ? "video_convert" : "image_convert"];
    const any = requestedFormatWord(p);
    const target = targetFormat(prompt, op.targets!);
    if (!target && any && canonicalId(any)) { /* fall through to the format registry below */ }
    else if (!target) {
      if (!any) return null;
      return { error: `I can convert ${video ? "videos" : "images"} to ${op.targets!.join(", ").toUpperCase()} — "${any.toUpperCase()}" isn't supported.` };
    }
    if (target) {
    if (sourceFormat(f.name) === target) return { error: `This file is already ${target.toUpperCase()}.` };
    if (f.size > op.maxInput) return { error: `${video ? "Videos" : "Images"} up to ${op.maxInput / MB} MB can be converted.` };
    return { operation: op.id, params: { target }, fileIndex: 0 };
    }
  }
  if (wantsConvert) {
    const fmt = formatOfName(f.name);
    const word = requestedFormatWord(p);
    const tgt = word ? canonicalId(word.replace(/\.$/, "")) : null;
    if (fmt && tgt) {
      const r = routeConversion(fmt.id, tgt);
      if (r.where === "runtime") {
        const op = RUNTIME_OPS[r.op as RuntimeOpId];
        if (f.size > op.maxInput) return { error: `Files up to ${op.maxInput / MB} MB can be converted.` };
        return { operation: op.id, params: RUNTIME_SOURCES[op.id] ? { target: tgt, source: fmt.id } : { target: tgt }, fileIndex: 0 };
      }
      if (r.where === "unsupported" && !FORMAT_BY_ID.get(fmt.id)!.inline.length) return { error: r.reason };
    }
  }
  if (/\b(sha-?(256|512)|checksum|hash)\b/.test(p) && f.size >= RUNTIME_LIMITS.inlineChecksumMax && f.size <= RUNTIME_OPS.checksum.maxInput) {
    const expected = prompt.match(/\b([0-9a-f]{128}|[0-9a-f]{64})\b/i)?.[1]?.toLowerCase();
    const algorithms = /512/.test(p) && !/256/.test(p) ? ["sha512"] : /512/.test(p) ? ["sha256", "sha512"] : ["sha256"];
    return { operation: "checksum", params: { algorithms, ...(expected ? { expected } : {}) }, fileIndex: 0 };
  }
  return null;
}

/** Validates params for an operation; only known keys and values survive. */
export function cleanParams(op: RuntimeOpId, params: any): Record<string, unknown> {
  if (op === "story_generate" || op === "prompt_generate") {
    const prompt = typeof params?.prompt === "string" ? params.prompt : "";
    return { prompt };
  }
  if (op === "checksum") {
    const algorithms = (Array.isArray(params?.algorithms) ? params.algorithms : ["sha256"]).filter((a: unknown) => a === "sha256" || a === "sha512");
    const expected = typeof params?.expected === "string" && /^([0-9a-f]{64}|[0-9a-f]{128})$/.test(params.expected) ? params.expected : undefined;
    return { algorithms: algorithms.length ? algorithms : ["sha256"], ...(expected ? { expected } : {}) };
  }
  const t = String(params?.target ?? "");
  if (!RUNTIME_OPS[op].targets!.includes(t)) throw new Error("Unsupported output format.");
  const srcs = RUNTIME_SOURCES[op];
  if (!srcs) return { target: t };
  const src = String(params?.source ?? "");
  if (!srcs.includes(src)) throw new Error("Unsupported input format.");
  const table = typeof params?.table === "string" && /^[\w .-]{1,64}$/.test(params.table) ? params.table : undefined;
  return { target: t, source: src, ...(table ? { table } : {}) };
}

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  gif: (b) => ascii(b, 0, 4) === "GIF8",
  bmp: (b) => ascii(b, 0, 2) === "BM",
  tiff: (b) => ascii(b, 0, 4) === "II*\u0000" || ascii(b, 0, 4) === "MM\u0000*",
  ico: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  mp4: (b) => ascii(b, 4, 8) === "ftyp",
  mov: (b) => ascii(b, 4, 8) === "ftyp" || ascii(b, 4, 8) === "moov" || ascii(b, 4, 8) === "wide",
  webm: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  mkv: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};
const TEXT_TARGETS = new Set(["csv", "json", "txt", "html", "svg", "geojson", "fb2"]);
const utf8 = (b: Uint8Array) => { try { new TextDecoder("utf-8", { fatal: true }).decode(b); return true; } catch { return false; } };
const SIG_ALIAS: Record<string, string> = { "7z": "7z", tgz: "tgz", sqlite: "sqlite" };
function ascii(b: Uint8Array, s: number, e: number) { return String.fromCharCode(...b.subarray(s, e)); }

/** Checks the produced bytes really are the requested format. */
export function outputMatches(target: string, bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  if (MAGIC[target]) return MAGIC[target](bytes);
  if (TEXT_TARGETS.has(target)) { if (!utf8(bytes)) return false; if (target === "json" || target === "geojson") { try { JSON.parse(new TextDecoder().decode(bytes)); } catch { return false; } } if (target === "svg") return /<svg\b/i.test(new TextDecoder().decode(bytes.subarray(0, 4096))); return true; }
  const id = SIG_ALIAS[target] ?? target;
  if (target === "mobi" || target === "azw3") return matchesSignature("mobi", bytes);
  return FORMAT_BY_ID.has(id) ? matchesSignature(id, bytes) && hasSig(id) : false;
}
const hasSig = (id: string) => !["txt"].includes(id);

const EXTRA_MIME: Record<string, string> = { txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html", svg: "image/svg+xml", sqlite: "application/vnd.sqlite3", tgz: "application/gzip", cbz: "application/vnd.comicbook+zip" };
export const TARGET_MIME: Record<string, string> = new Proxy({} as Record<string, string>, { get: (_t, k: string) => BASE_MIME[k] ?? EXTRA_MIME[k] ?? FORMAT_BY_ID.get(k)?.mime ?? "application/octet-stream" });
const BASE_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska" };

export function outputName(source: string, target: string) {
  const base = (source.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "converted";
  return `${base}.${target === "jpeg" ? "jpg" : target}`;
}
