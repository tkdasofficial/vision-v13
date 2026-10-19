// Static project checks that run without installing or building anything:
// required files, JSON validity, JS/TS syntax, relative imports, HTML links/navigation, CSS braces.
import { parse } from "@babel/parser";
import { STACKS, type GenFile, type Stack } from "./stacks";

export type Diagnostic = { path: string; line?: number; severity: "error" | "warning"; message: string };
export type ValidationReport = { errors: Diagnostic[]; warnings: Diagnostic[]; checked: string[]; notChecked: string[] };

const JS_RE = /\.(m?js|cjs|jsx|ts|tsx)$/;
const RESOLVE_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function dirname(p: string) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
export function joinPath(base: string, rel: string): string | null {
  const parts = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join("/");
}

export function syntaxCheck(path: string, code: string): Diagnostic | null {
  const ts = /\.tsx?$/.test(path);
  const jsx = /\.(jsx|tsx)$/.test(path) || (/\.js$/.test(path) && /<[A-Z][\w.]*[\s/>]/.test(code));
  try {
    parse(code, { sourceType: "unambiguous", plugins: [...(ts ? (["typescript"] as const) : []), ...(jsx ? (["jsx"] as const) : [])], errorRecovery: false });
    return null;
  } catch (e: any) {
    return { path, line: e.loc?.line, severity: "error", message: `Syntax error: ${String(e.message).replace(/\s*\(\d+:\d+\)$/, "")}` };
  }
}

function importsOf(code: string): string[] {
  const out: string[] = [];
  const re = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\(\s*|export\s[^'"]*?from\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(m[1]);
  return out;
}

export function validateProject(stack: Stack, files: GenFile[]): ValidationReport {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const checked = new Set<string>();
  const notChecked = new Set<string>();
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  for (const req of STACKS[stack].required) if (!byPath.has(req)) errors.push({ path: req, severity: "error", message: "Required file is missing." });
  checked.add("Required files");

  let pkg: any = null;
  for (const f of files) {
    if (!f.content.trim()) warnings.push({ path: f.path, severity: "warning", message: "File is empty." });
    if (f.path.endsWith(".json")) {
      checked.add("JSON files");
      try { const v = JSON.parse(f.content); if (f.path === "package.json") pkg = v; }
      catch (e: any) { errors.push({ path: f.path, severity: "error", message: `Invalid JSON: ${e.message}` }); }
    } else if (JS_RE.test(f.path)) {
      checked.add("JavaScript/TypeScript syntax");
      const d = syntaxCheck(f.path, f.content);
      if (d) errors.push(d);
      checked.add("Relative imports");
      for (const spec of importsOf(f.content)) {
        if (!spec.startsWith(".")) {
          const root = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
          if (pkg === null && byPath.has("package.json")) { try { pkg = JSON.parse(byPath.get("package.json")!); } catch { /* reported */ } }
          if (pkg && !/^(node:|react$|react-dom$|vite)/.test(spec) && !pkg.dependencies?.[root] && !pkg.devDependencies?.[root] && !isNodeBuiltin(root)) {
            errors.push({ path: f.path, severity: "error", message: `Package "${root}" is imported but not listed in package.json.` });
          }
          continue;
        }
        const target = joinPath(dirname(f.path), spec);
        if (target === null || !RESOLVE_EXT.some((ext) => byPath.has(target + ext))) {
          if (/\.(css|svg|png|jpe?g|gif|webp)$/.test(spec) && target && byPath.has(target)) continue;
          errors.push({ path: f.path, severity: "error", message: `Import "${spec}" does not match any file in the project.` });
        }
      }
    } else if (f.path.endsWith(".html")) {
      checked.add("HTML links");
      const re = /(?:href|src)\s*=\s*["']([^"'#?]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content))) {
        const url = m[1];
        if (/^(https?:|mailto:|tel:|data:|\/\/|javascript:)/i.test(url)) continue;
        const target = url.startsWith("/") ? url.slice(1) : joinPath(dirname(f.path), url);
        if (stack.startsWith("react") && url.startsWith("/src/") && byPath.has(url.slice(1))) continue;
        if (target === null || (!byPath.has(target) && !byPath.has(target.replace(/\/$/, "") + "/index.html"))) {
          errors.push({ path: f.path, severity: "error", message: `Link "${url}" points to a file that does not exist.` });
        }
      }
      if (!/<title>[^<]+<\/title>/i.test(f.content)) warnings.push({ path: f.path, severity: "warning", message: "Page has no <title>." });
    } else if (f.path.endsWith(".css")) {
      checked.add("CSS braces");
      const open = (f.content.match(/{/g) ?? []).length, close = (f.content.match(/}/g) ?? []).length;
      if (open !== close) errors.push({ path: f.path, severity: "error", message: `Unbalanced braces in CSS (${open} "{" vs ${close} "}").` });
    } else if (/\.(py|java|c|cpp|go|rs|rb|php|kt|swift|cs)$/.test(f.path)) {
      notChecked.add(`Syntax of .${f.path.split(".").pop()} files (no checker for this language here)`);
    }
  }

  if (stack === "html-site") {
    checked.add("Page navigation");
    const pages = files.filter((f) => f.path.endsWith(".html")).map((f) => f.path);
    for (const p of pages) {
      const html = byPath.get(p)!;
      const missing = pages.filter((q) => q !== p && !new RegExp(`href\\s*=\\s*["'](\\./)?${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'#?]`, "i").test(html));
      if (missing.length) warnings.push({ path: p, severity: "warning", message: `No link to: ${missing.join(", ")}.` });
    }
  }
  if (pkg && (stack === "react-ts-vite" || stack === "react-js-vite") && !pkg.scripts?.build) errors.push({ path: "package.json", severity: "error", message: 'Missing "build" script.' });

  notChecked.add("Dependency install, build and tests (no build environment is connected)");
  return { errors, warnings, checked: [...checked], notChecked: [...notChecked] };
}

const BUILTINS = new Set(["fs", "path", "os", "url", "http", "https", "crypto", "events", "stream", "util", "child_process", "zlib", "assert", "buffer", "net", "readline", "test", "worker_threads", "timers"]);
function isNodeBuiltin(n: string) { return BUILTINS.has(n.replace(/^node:/, "")); }
