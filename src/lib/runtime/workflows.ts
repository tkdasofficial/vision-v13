// Workflow routing for the Vision-Runtime repo: 20 one-word workflows (terminal is a manual alias of logs).
// Pure and shared by the dispatcher (github.server.ts) and the relay (auth-gateway/src/runtime.ts),
// so a runner can only claim jobs routed to the exact workflow it runs in.
// Mirrored by registry/workflows.json in tkdasofficial/vision-runtime (kept in sync by tests on both sides).
import type { RuntimeOpId } from "./operations";

export type Workflow = { worker: string; ops: RuntimeOpId[]; sources?: string[] };

const CK: RuntimeOpId = "checksum";
export const WORKFLOWS: Record<string, Workflow> = {
  documents: { worker: "documents", ops: ["office_convert", "render", CK], sources: ["doc", "docx", "odt", "rtf", "txt", "html", "md", "pdf", "tex"] },
  spreadsheets: { worker: "spreadsheets", ops: ["office_convert", CK], sources: ["xls", "xlsx", "ods", "csv", "tsv"] },
  data: { worker: "data", ops: ["data_convert", CK], sources: ["parquet", "avro", "csv", "json", "jsonl", "xml", "sql", "sqlite", "db"] },
  presentations: { worker: "presentations", ops: ["office_convert", CK], sources: ["ppt", "pptx", "odp"] },
  code: { worker: "code", ops: [CK], sources: ["css", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "php", "rb", "swift", "kt", "kts", "sh", "bat", "ps1", "ipynb"] },
  config: { worker: "config", ops: [CK], sources: ["yaml", "yml", "toml", "env", "ini", "cfg", "conf", "properties", "dockerfile", "gitignore"] },
  images: { worker: "images", ops: ["image_convert", CK], sources: ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif", "gif", "ico", "avif", "heic", "heif"] },
  audio: { worker: "audio", ops: ["audio_convert", CK], sources: ["wav", "mp3", "flac", "ogg", "m4a", "aac", "wma", "opus", "aiff", "aif"] },
  video: { worker: "video", ops: ["video_convert", CK], sources: ["mp4", "webm", "mov", "mkv", "avi", "wmv", "m4v", "mpeg", "mpg", "3gp"] },
  archives: { worker: "archives", ops: ["archive_convert", CK], sources: ["zip", "tar", "gz", "tgz", "7z", "rar", "cbz", "cbr"] },
  subtitles: { worker: "subtitles", ops: [CK], sources: ["srt", "vtt", "ass", "ssa", "lrc"] },
  ebooks: { worker: "ebooks", ops: ["ebook_convert", CK], sources: ["epub", "mobi", "azw3", "fb2"] },
  diagrams: { worker: "diagrams", ops: ["render", CK], sources: ["svg", "mmd", "mermaid", "dot", "gv", "puml", "plantuml", "dxf", "drawio", "dio"] },
  fonts: { worker: "fonts", ops: ["font_convert", CK], sources: ["ttf", "otf", "woff", "woff2"] },
  maps: { worker: "maps", ops: ["data_convert", CK], sources: ["shp", "geojson", "kml", "gpx"] },
  contacts: { worker: "contacts", ops: [CK], sources: ["vcf", "vcard"] },
  calendars: { worker: "calendars", ops: [CK], sources: ["ics", "ical"] },
  logs: { worker: "logs", ops: [CK] },
  prompts: { worker: "prompts", ops: ["prompt_generate", "story_generate"] }, // single or linked prompt series with locked consistency
  terminal: { worker: "logs", ops: [CK] }, // manual checksum entry point; never picked by routing // logs/diffs, plus checksum for any file no other workflow owns
};

/** Ops whose workflow is fixed regardless of the file. */
const BY_OP: Partial<Record<RuntimeOpId, string>> = { story_generate: "prompts", prompt_generate: "prompts", image_convert: "images", video_convert: "video", audio_convert: "audio", font_convert: "fonts", ebook_convert: "ebooks" };

export const extOf = (name: unknown) => { const m = String(name ?? "").toLowerCase().match(/\.([a-z0-9]{1,12})$/); return m ? m[1] : String(name ?? "").toLowerCase().split(/[\\/]/).pop() === "dockerfile" ? "dockerfile" : ""; };

/** Picks the one workflow file (without .yml) that must run this job, or null when no workflow may. */
export function pickWorkflow(op: string, source: unknown, fileName?: unknown): string | null {
  const fixed = BY_OP[op as RuntimeOpId];
  if (fixed) return fixed;
  const src = String(source ?? "").toLowerCase() || extOf(fileName);
  for (const [name, w] of Object.entries(WORKFLOWS)) if (w.sources?.includes(src) && w.ops.includes(op as RuntimeOpId)) return name;
  return op === "checksum" ? "logs" : null;
}

export const workflowRef = (repo: string, name: string) => `${repo}/.github/workflows/${name}.yml@refs/heads/main`;
