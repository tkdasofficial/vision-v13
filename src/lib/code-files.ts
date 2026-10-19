// Language → file extension and safe filename helpers for code downloads.
import { exportToDrive } from './drive-export';
const EXT: Record<string, string> = {
  html: "html", htm: "html", css: "css", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  python: "py", py: "py", json: "json", markdown: "md", md: "md", sql: "sql", xml: "xml", svg: "svg", scss: "scss", less: "less", markup: "html", yaml: "yaml", yml: "yaml",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs",
  go: "go", rust: "rs", rs: "rs", ruby: "rb", rb: "rb", php: "php", swift: "swift", kotlin: "kt", dart: "dart", vue: "vue", svelte: "svelte",
};

export function extensionFor(lang?: string) {
  return (lang && EXT[lang.toLowerCase()]) || "txt";
}

export function sanitizeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
}

export function filenameFor(lang?: string, suggested?: string) {
  const clean = suggested ? sanitizeFilename(suggested) : "";
  if (clean && /\.[a-z0-9]+$/i.test(clean)) return lang === "html" && /\.xml$/i.test(clean) ? clean.replace(/\.xml$/i, ".html") : clean;
  return `${clean || "code"}.${extensionFor(lang)}`;
}

export function downloadText(content: string, filename: string, mime = "text/plain") {
  return exportToDrive(new Blob([content], { type: `${mime};charset=utf-8` }), filename);
}
