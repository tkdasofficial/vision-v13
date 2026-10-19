// Plugin manifest: 96 file-format plugins (every canonical format except Code/Development, which Coding Mode
// handles) + Web Search + three repository analyzers. Pure and browser-safe; capabilities come straight from
// the format registry so the UI never advertises an operation that has no implementation.
import { FORMATS, FORMAT_BY_ID, canonicalId, formatOfName, routeConversion, type Category, type Format } from "@/lib/formats/inventory";

export type PluginKind = "format" | "search" | "repo";
export type RepoProvider = "github" | "gitlab" | "bitbucket";
export type PluginCaps = { create: boolean; read: boolean; convertsTo: string[]; convertsFrom: string[] };
export type PluginDef = {
  id: string; name: string; tagline: string; kind: PluginKind; group: string;
  /** Canonical format id (format plugins only). */
  format?: string; exts?: string[]; mime?: string; caps?: PluginCaps;
  provider?: RepoProvider; tool?: string;
};

export const GROUPS: Record<Exclude<Category, "code">, string> = {
  document: "Documents", spreadsheet: "Spreadsheets", data: "Data and Databases", presentation: "Presentations",
  config: "Configuration Files", image: "Images", audio: "Audio", video: "Video", archive: "Archives",
  subtitle: "Subtitles and Transcripts", ebook: "E-books and Publishing", diagram: "Diagrams and Graphics", font: "Fonts",
  geo: "Maps and Geospatial Data", contact: "Contacts", calendar: "Calendars", log: "Logs and Diffs",
};
const NOUN: Record<string, string> = { image: "images", audio: "audio", video: "videos", font: "fonts", archive: "archives", subtitle: "subtitles", ebook: "e-books", diagram: "diagrams" };
const LABEL: Record<string, string> = { jpeg: "JPEG", webp: "WebP", opus: "Opus", env: ".env", gitignore: ".gitignore", dockerfile: "Dockerfile", drawio: "draw.io", sqlite: "SQLite", geojson: "GeoJSON", jsonl: "JSONL", "3gp": "3GP" };

export const CODE_FORMAT_IDS = FORMATS.filter((f) => f.category === "code").map((f) => f.id);
const ELIGIBLE = FORMATS.filter((f) => f.category !== "code");

function convertsTo(f: Format) { return [...new Set([...f.inline, ...(f.runtime?.targets ?? [])])].filter((t) => routeConversion(f.id, t).where !== "unsupported"); }
const INCOMING = new Map<string, string[]>();
for (const s of FORMATS) for (const t of convertsTo(s)) { const id = canonicalId(t); if (id) INCOMING.set(id, [...(INCOMING.get(id) ?? []), s.id]); }

function tagline(f: Format, label: string, caps: PluginCaps): string {
  const full = f.name.toUpperCase() === label.toUpperCase() ? label : `${f.name} (${label})`;
  const noun = NOUN[f.category] ?? "files";
  if (f.id === "zip") return "Package files into ZIP archives, inspect and repack them.";
  if (caps.create) return `Create${caps.read ? ", read" : ""}${caps.convertsTo.length ? " and convert" : ""} ${full} files.`;
  if (caps.convertsFrom.length && caps.convertsTo.length) return `Convert ${noun} to and from ${full}.`;
  if (caps.convertsFrom.length) return `Convert supported ${noun} into ${full}.`;
  if (caps.convertsTo.length) return `Read and convert ${full} files to other formats.`;
  return `Inspect ${full} files.`;
}

const formatPlugin = (f: Format): PluginDef => {
  const label = LABEL[f.id] ?? f.id.toUpperCase();
  const caps: PluginCaps = { create: f.create, read: f.read, convertsTo: convertsTo(f), convertsFrom: [...new Set(INCOMING.get(f.id) ?? [])] };
  return { id: f.id, name: label, tagline: tagline(f, label, caps), kind: "format", group: GROUPS[f.category as Exclude<Category, "code">], format: f.id, exts: f.exts, mime: f.mime, caps };
};

export const EXTRA_PLUGINS: PluginDef[] = [
  { id: "web-search", name: "Web Search", tagline: "Find relevant information from available web sources.", kind: "search", group: "Search and Repositories", tool: "web_search" },
  { id: "github-analyzer", name: "GitHub Analyzer", tagline: "Inspect and explain public GitHub repositories.", kind: "repo", group: "Search and Repositories", provider: "github", tool: "github_repo" },
  { id: "gitlab-analyzer", name: "GitLab Analyzer", tagline: "Inspect and explain public GitLab repositories.", kind: "repo", group: "Search and Repositories", provider: "gitlab", tool: "gitlab_repo" },
  { id: "bitbucket-analyzer", name: "Bitbucket Analyzer", tagline: "Inspect and explain public Bitbucket repositories.", kind: "repo", group: "Search and Repositories", provider: "bitbucket", tool: "bitbucket_repo" },
];
export const FORMAT_PLUGINS: PluginDef[] = ELIGIBLE.map(formatPlugin);
export const ALL_PLUGINS: PluginDef[] = [...EXTRA_PLUGINS, ...FORMAT_PLUGINS];
export const PLUGIN_BY_ID = new Map(ALL_PLUGINS.map((p) => [p.id, p]));
export const GROUP_ORDER = ["Search and Repositories", ...Object.values(GROUPS)];
export const DEFAULT_PLUGIN_IDS = ["web-search", "github-analyzer", "pdf", "docx", "xlsx"] as const;

/** Resolves a plugin from a name or alias ("JPG" → JPEG plugin); code formats resolve to nothing. */
export function pluginFor(name: string): PluginDef | null {
  const direct = PLUGIN_BY_ID.get(name.toLowerCase()) ?? ALL_PLUGINS.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (direct) return direct;
  const id = canonicalId(name);
  return id ? PLUGIN_BY_ID.get(id) ?? null : null;
}

/** Untrusted stored selection → known, de-duplicated ids; null/missing means "never set" → defaults. */
export function normalizeSelection(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PLUGIN_IDS];
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && PLUGIN_BY_ID.has(x)))];
}

export type PluginSend =
  | { kind: "chat"; content: string; webSearch: boolean }
  | { kind: "agent"; prompt: string }
  | { kind: "files"; prompt: string }
  | { kind: "reply"; text: string };

const listFmts = (ids: string[], n = 8) => ids.slice(0, n).map((i) => (PLUGIN_BY_ID.get(i)?.name ?? i.toUpperCase())).join(", ") + (ids.length > n ? ` and ${ids.length - n} more` : "");

/** Decides what a message with selected plugins does. The plugin gives the target, the file gives the source. */
export function planPluginSend(pluginIds: string[], typed: string, files: { name: string }[]): PluginSend | null {
  const ps = pluginIds.map((i) => PLUGIN_BY_ID.get(i)).filter((p): p is PluginDef => !!p);
  if (!ps.length) return null;
  const text = typed.trim();
  const repo = ps.find((p) => p.kind === "repo");
  const search = ps.some((p) => p.kind === "search");
  const targets = ps.filter((p) => p.kind === "format");
  if (repo) {
    if (!text) return { kind: "reply", text: `Paste a public ${repo.name.replace(" Analyzer", "")} repository link (or owner/name) and what you want to know.` };
    return { kind: "agent", prompt: `Use the ${repo.tool} tool to analyze this public repository, then answer from the files it actually retrieved.\n\n${text}` };
  }
  if (targets.length > 1) return { kind: "reply", text: `Pick one target format — ${targets.map((t) => t.name).join(" and ")} are both selected.` };
  const t = targets[0];
  if (!t) {
    if (!text) return { kind: "reply", text: "Type what you want to search the web for." };
    return { kind: "chat", content: text, webSearch: search };
  }
  const tf = FORMAT_BY_ID.get(t.format!)!;
  const prefix = search && text ? `First use web_search to find sources for: ${text}\nThen ` : "";
  if (files.length) {
    if (t.format === "zip") return { kind: "files", prompt: `Bundle the attached files into one ZIP with zip_create.${text ? `\n\n${text}` : ""}` };
    if (files.length > 1) return { kind: "reply", text: `Which file should become ${t.name}? Attach just that one, or remove the others.` };
    const src = formatOfName(files[0].name);
    if (!src) return { kind: "reply", text: `I can't tell what kind of file "${files[0].name}" is, so I can't convert it to ${t.name}.` };
    if (src.id === t.format) return { kind: "reply", text: `"${files[0].name}" is already ${t.name} — no conversion needed.` };
    const r = routeConversion(src.id, t.format!);
    if (r.where === "unsupported") return { kind: "reply", text: r.reason };
    return { kind: "files", prompt: `Convert this file to ${t.format}.${text ? `\n\n${text}` : ""}` };
  }
  if (t.format === "zip") {
    if (!text) return { kind: "reply", text: "Tell me which files to create for the ZIP, or attach the files to package." };
    return { kind: "agent", prompt: `${prefix}Create the requested files with the document tools, then bundle all of them into one ZIP with zip_create.\n\n${text}` };
  }
  if (tf.create) {
    if (!text) return { kind: "reply", text: `Tell me what to put in the ${t.name} file, or attach a file to convert.` };
    return { kind: "agent", prompt: `${prefix}${text}\n\n(Save the result as a .${tf.exts[0]} file.)` };
  }
  const from = t.caps?.convertsFrom ?? [];
  return { kind: "reply", text: from.length ? `${t.name} can't be created from scratch. Attach a file to convert — for example ${listFmts(from)}.` : `${t.name} files can only be inspected; attach one and ask about it.` };
}
