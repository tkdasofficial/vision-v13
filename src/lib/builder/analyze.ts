// Static analysis of an extracted project (no code is executed): inventory, stack, scripts,
// structure, findings and generated documentation.
import { findSecretKinds } from "../../../security/archive/zip-guard";
import type { ReadEntry } from "./archive";

export type Finding = { severity: "high" | "medium" | "low" | "info"; title: string; path?: string; detail: string };
export type ProjectAnalysis = {
  name: string;
  root: string;
  inventory: { files: number; folders: number; totalBytes: number; byExtension: Record<string, number>; largest: { path: string; size: number }[] };
  tree: string;
  stack: string[];
  packageManagers: string[];
  entryPoints: string[];
  scripts: Record<string, string>;
  dependencies: { name: string; version: string; dev: boolean }[];
  routes: string[];
  modules: { path: string; imports: number }[];
  instructions: { install?: string; run?: string; build?: string; test?: string };
  findings: Finding[];
  limitations: string[];
};

function commonRoot(paths: string[]): string {
  const firsts = new Set(paths.map((p) => p.split("/")[0]));
  return firsts.size === 1 && paths.every((p) => p.includes("/")) ? [...firsts][0] : "";
}

function renderTree(paths: string[], max = 300): string {
  const lines: string[] = [];
  const sorted = [...paths].sort();
  for (const p of sorted.slice(0, max)) {
    const depth = p.split("/").length - 1;
    lines.push(`${"  ".repeat(depth)}${p.split("/").pop()}`);
  }
  if (sorted.length > max) lines.push(`… ${sorted.length - max} more`);
  return lines.join("\n");
}

export function analyzeProject(fileName: string, entries: ReadEntry[], skippedText: number): ProjectAnalysis {
  const files = entries.filter((e) => !e.dir);
  const root = commonRoot(files.map((f) => f.path));
  const rel = (p: string) => (root && p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
  const byRel = new Map(files.map((f) => [rel(f.path), f]));
  const text = (p: string) => byRel.get(p)?.text;
  const folders = new Set<string>();
  files.forEach((f) => { const parts = rel(f.path).split("/"); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/")); });

  const byExtension: Record<string, number> = {};
  for (const f of files) { const ext = rel(f.path).includes(".") ? rel(f.path).split(".").pop()!.toLowerCase() : "(none)"; byExtension[ext] = (byExtension[ext] ?? 0) + 1; }

  const findings: Finding[] = [];
  const stack: string[] = [], packageManagers: string[] = [], entryPoints: string[] = [];
  let scripts: Record<string, string> = {};
  const dependencies: ProjectAnalysis["dependencies"] = [];
  const instructions: ProjectAnalysis["instructions"] = {};

  const pkgText = text("package.json");
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      scripts = pkg.scripts ?? {};
      for (const [n, v] of Object.entries(pkg.dependencies ?? {})) dependencies.push({ name: n, version: String(v), dev: false });
      for (const [n, v] of Object.entries(pkg.devDependencies ?? {})) dependencies.push({ name: n, version: String(v), dev: true });
      const has = (n: string) => dependencies.some((d) => d.name === n);
      if (has("react")) stack.push("React");
      if (has("next")) stack.push("Next.js");
      if (has("vite")) stack.push("Vite");
      if (has("vue")) stack.push("Vue");
      if (has("svelte")) stack.push("Svelte");
      if (has("express")) stack.push("Express");
      if (has("typescript") || byRel.has("tsconfig.json")) stack.push("TypeScript");
      if (!stack.length) stack.push("Node.js");
      const pm = byRel.has("bun.lockb") || byRel.has("bun.lock") ? "bun" : byRel.has("pnpm-lock.yaml") ? "pnpm" : byRel.has("yarn.lock") ? "yarn" : "npm";
      packageManagers.push(pm);
      if (!["bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"].some((l) => byRel.has(l))) findings.push({ severity: "low", title: "No lockfile", detail: "Installs may resolve different dependency versions." });
      instructions.install = `${pm} install`;
      const runCmd = (s: string) => (pm === "npm" ? `npm run ${s}` : `${pm} run ${s}`);
      if (scripts.dev) instructions.run = runCmd("dev"); else if (scripts.start) instructions.run = `${pm} start`;
      if (scripts.build) instructions.build = runCmd("build");
      if (scripts.test) instructions.test = `${pm} test`;
      if (pkg.main) entryPoints.push(pkg.main);
    } catch { findings.push({ severity: "high", title: "Invalid package.json", path: "package.json", detail: "package.json is not valid JSON." }); }
  }
  if (byRel.has("requirements.txt") || byRel.has("pyproject.toml")) {
    stack.push("Python"); packageManagers.push(byRel.has("pyproject.toml") ? "pip/pyproject" : "pip");
    instructions.install ??= "pip install -r requirements.txt";
    for (const ep of ["main.py", "app.py", "manage.py", "app/main.py"]) if (byRel.has(ep)) { entryPoints.push(ep); instructions.run ??= `python ${ep}`; }
    if ([...byRel.keys()].some((p) => /(^|\/)tests?\//.test(p))) instructions.test ??= "pytest";
  }
  if (byRel.has("go.mod")) { stack.push("Go"); instructions.build ??= "go build ./..."; instructions.test ??= "go test ./..."; }
  if (byRel.has("Cargo.toml")) { stack.push("Rust"); instructions.build ??= "cargo build"; instructions.test ??= "cargo test"; }
  if (byRel.has("pom.xml")) { stack.push("Java (Maven)"); instructions.build ??= "mvn package"; }
  if (byRel.has("build.gradle") || byRel.has("build.gradle.kts")) { stack.push("Java/Kotlin (Gradle)"); instructions.build ??= "./gradlew build"; }
  if (byRel.has("Dockerfile")) stack.push("Docker");
  if (!stack.length && [...byRel.keys()].some((p) => p.endsWith(".html"))) { stack.push("Static HTML site"); instructions.run = "Open index.html in a browser"; }
  for (const ep of ["index.html", "src/main.tsx", "src/main.jsx", "src/index.ts", "src/index.js", "index.js", "server.js"]) if (byRel.has(ep) && !entryPoints.includes(ep)) entryPoints.push(ep);

  // Routes and module relationships.
  const routes = [...byRel.keys()].filter((p) => /^(src\/)?(app|pages|routes)\/.+\.(tsx?|jsx?|vue|svelte)$/.test(p)).slice(0, 200);
  const modules: ProjectAnalysis["modules"] = [];
  for (const [p, f] of byRel) {
    if (!f.text || !/\.(m?js|jsx|tsx?)$/.test(p)) continue;
    const n = (f.text.match(/^\s*import\s|require\(/gm) ?? []).length;
    modules.push({ path: p, imports: n });
  }
  modules.sort((a, b) => b.imports - a.imports);

  // Findings.
  for (const [p, f] of byRel) {
    if (/(^|\/)\.env(\.(?!example|sample|template).+)?$/.test(p)) findings.push({ severity: "high", title: "Environment file included", path: p, detail: "Real .env files often contain secrets and should not be shared." });
    if (/\.(pem|key|p12|pfx)$|id_rsa$/.test(p)) findings.push({ severity: "high", title: "Key file included", path: p, detail: "Private key material should never be shipped in a project archive." });
    if (f.text) {
      const kinds = findSecretKinds(f.text);
      if (kinds.length) findings.push({ severity: "high", title: "Possible secret in source", path: p, detail: `${kinds.join(", ")} pattern found. Needs verification; value not shown.` });
      if (/\beval\s*\(/.test(f.text) && /\.(m?js|tsx?|jsx)$/.test(p)) findings.push({ severity: "medium", title: "Use of eval()", path: p, detail: "eval can execute untrusted input. Needs review." });
      if (/dangerouslySetInnerHTML/.test(f.text)) findings.push({ severity: "low", title: "dangerouslySetInnerHTML", path: p, detail: "Make sure inserted HTML is sanitized." });
    }
    if (f.nestedArchive) findings.push({ severity: "info", title: "Nested archive not opened", path: p, detail: "Archives inside the ZIP are listed but not extracted." });
    if (f.size > 5 * 1024 * 1024) findings.push({ severity: "low", title: "Large file", path: p, detail: `${(f.size / 1048576).toFixed(1)} MB.` });
  }
  if ([...byRel.keys()].some((p) => p.split("/").includes("node_modules"))) findings.push({ severity: "low", title: "node_modules included", detail: "Dependency folders inflate the archive; reinstall instead of shipping them." });
  if (!byRel.has("README.md") && !byRel.has("readme.md")) findings.push({ severity: "low", title: "No README", detail: "Project has no README file." });
  if (!byRel.has("LICENSE") && !byRel.has("LICENSE.md")) findings.push({ severity: "info", title: "No license file", detail: "Usage rights are unclear without a license." });
  if (pkgText && !scripts.test) findings.push({ severity: "info", title: "No test script", detail: "package.json has no test script." });
  if (byRel.has("tsconfig.json")) { try { JSON.parse((text("tsconfig.json") ?? "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,(\s*[}\]])/g, "$1")); } catch { findings.push({ severity: "medium", title: "tsconfig.json could not be parsed", path: "tsconfig.json", detail: "TypeScript configuration may be invalid." }); } }

  const limitations = [
    "Code was inspected statically; nothing was installed, built, run or tested.",
    "Findings are pattern-based and need verification.",
  ];
  if (skippedText) limitations.push(`${skippedText} text file(s) were too large or over the file limit and were not read.`);

  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 10).map((f) => ({ path: rel(f.path), size: f.size }));
  return {
    name: root || fileName.replace(/\.zip$/i, ""),
    root,
    inventory: { files: files.length, folders: folders.size, totalBytes: files.reduce((s, f) => s + f.size, 0), byExtension, largest },
    tree: renderTree(files.map((f) => rel(f.path))),
    stack: [...new Set(stack)], packageManagers, entryPoints, scripts, dependencies, routes, modules: modules.slice(0, 30), instructions,
    findings: findings.slice(0, 200), limitations,
  };
}

const fmt = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

export function documentationMarkdown(a: ProjectAnalysis, summary?: string): string {
  const ins = a.instructions;
  return [
    `# ${a.name} — Project documentation`,
    summary ? `\n${summary}\n` : "",
    `## Stack\n\n${a.stack.length ? a.stack.map((s) => `- ${s}`).join("\n") : "- Not detected"}`,
    `## Getting started\n\n${[ins.install && `Install: \`${ins.install}\``, ins.run && `Run: \`${ins.run}\``, ins.build && `Build: \`${ins.build}\``, ins.test && `Test: \`${ins.test}\``].filter(Boolean).map((l) => `- ${l}`).join("\n") || "- No instructions could be inferred."}`,
    `## Entry points\n\n${a.entryPoints.map((e) => `- \`${e}\``).join("\n") || "- Not detected"}`,
    a.routes.length ? `## Routes / pages\n\n${a.routes.map((r) => `- \`${r}\``).join("\n")}` : "",
    Object.keys(a.scripts).length ? `## Scripts\n\n| Script | Command |\n|---|---|\n${Object.entries(a.scripts).map(([k, v]) => `| ${k} | \`${v.replace(/\|/g, "\\|")}\` |`).join("\n")}` : "",
    a.dependencies.length ? `## Dependencies\n\n| Package | Version | Dev |\n|---|---|---|\n${a.dependencies.map((d) => `| ${d.name} | ${d.version} | ${d.dev ? "yes" : ""} |`).join("\n")}` : "",
    a.modules.length ? `## Most connected modules\n\n${a.modules.slice(0, 15).map((m) => `- \`${m.path}\` — ${m.imports} imports`).join("\n")}` : "",
    `## File tree\n\n\`\`\`\n${a.tree}\n\`\`\``,
  ].filter(Boolean).join("\n\n") + "\n";
}

export function reportMarkdown(a: ProjectAnalysis): string {
  const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const f = [...a.findings].sort((x, y) => order[x.severity] - order[y.severity]);
  return [
    `# ${a.name} — Analysis report`,
    `## Inventory\n\n- Files: ${a.inventory.files}\n- Folders: ${a.inventory.folders}\n- Total size: ${fmt(a.inventory.totalBytes)}`,
    `### File types\n\n${Object.entries(a.inventory.byExtension).sort((x, y) => y[1] - x[1]).map(([k, v]) => `- .${k}: ${v}`).join("\n")}`,
    `### Largest files\n\n${a.inventory.largest.map((l) => `- \`${l.path}\` — ${fmt(l.size)}`).join("\n")}`,
    `## Findings (${f.length})\n\n${f.length ? f.map((x) => `- **[${x.severity.toUpperCase()}] ${x.title}**${x.path ? ` — \`${x.path}\`` : ""}: ${x.detail}`).join("\n") : "- No findings."}`,
    `## Recommendations\n\n${recommendations(a).map((r) => `- ${r}`).join("\n")}`,
    `## Limitations\n\n${a.limitations.map((l) => `- ${l}`).join("\n")}`,
  ].join("\n\n") + "\n";
}

function recommendations(a: ProjectAnalysis): string[] {
  const r: string[] = [];
  if (a.findings.some((f) => f.severity === "high")) r.push("Remove secrets and key files from the project and rotate any exposed credentials.");
  if (a.findings.some((f) => f.title === "No README")) r.push("Add a README with setup and run instructions.");
  if (a.findings.some((f) => f.title === "No lockfile")) r.push("Commit a lockfile for reproducible installs.");
  if (a.findings.some((f) => f.title === "No test script")) r.push("Add automated tests and a test script.");
  if (!r.length) r.push("No urgent changes found by static inspection.");
  return r;
}
