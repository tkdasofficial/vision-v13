import { describe, it, expect } from "vitest";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { safeEntryPath, inspectEntries, isExcludedFromExport, findSecretKinds, ARCHIVE_LIMITS } from "../../security/archive/zip-guard";
import { packProject, verifyPack, readArchiveSafely } from "@/lib/builder/archive";
import { scaffold, parseFileBlocks, STACKS } from "@/lib/builder/stacks";
import { validateProject } from "@/lib/builder/validate";
import { analyzeProject, documentationMarkdown, reportMarkdown } from "@/lib/builder/analyze";
import { recoveredStatus, STALE_AFTER_MS } from "@/lib/builder/statuses";
import { filenameFor } from "@/lib/code-files";

describe("ZIP security", () => {
  it("rejects path traversal, absolute and drive paths", () => {
    expect(safeEntryPath("../etc/passwd")).toBeNull();
    expect(safeEntryPath("a/../../x")).toBeNull();
    expect(safeEntryPath("/abs/file")).toBeNull();
    expect(safeEntryPath("C:/win.ini")).toBeNull();
    expect(safeEntryPath("src/./app.ts")).toBe("src/app.ts");
  });

  it("flags archive bombs and too many entries", () => {
    expect(inspectEntries([{ name: "bomb.txt", compressedSize: 10_000, originalSize: 10_000 * 500 }]).issues[0].code).toBe("suspicious_ratio");
    const many = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}`, compressedSize: 1, originalSize: 1 }));
    expect(inspectEntries(many).ok).toBe(false);
  });

  it("refuses a real ZIP containing a traversal entry before extracting", () => {
    const bytes = zipSync({ "../evil.sh": strToU8("rm -rf /") });
    const r = readArchiveSafely(bytes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("unsafe_path");
  });

  it("rejects a real highly compressed bomb", () => {
    const big = new Uint8Array(30 * 1024 * 1024); // 30 MB of zeros compresses to a few KB
    const r = readArchiveSafely(zipSync({ "zeros.txt": big }, { level: 9 }));
    expect(r.ok).toBe(false);
  });

  it("gives a clear failure for invalid archives", () => {
    const r = readArchiveSafely(strToU8("definitely not a zip file at all"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("not_zip");
  });

  it("excludes secrets, caches and node_modules from exports", () => {
    expect(isExcludedFromExport(".env")).toBe(true);
    expect(isExcludedFromExport("node_modules/react/index.js")).toBe(true);
    expect(isExcludedFromExport("keys/server.pem")).toBe(true);
    expect(isExcludedFromExport(".env.example")).toBe(false);
    expect(isExcludedFromExport("src/App.tsx")).toBe(false);
  });

  it("detects secret patterns without returning values", () => {
    expect(findSecretKinds("const k = 'AKIAABCDEFGHIJKLMNOP'")).toContain("AWS access key");
  });
});

describe("Code export", () => {
  it("keeps the right extension per language", () => {
    expect(filenameFor("python")).toBe("code.py");
    expect(filenameFor("typescript", "util")).toBe("util.ts");
    expect(filenameFor("rust", "main.rs")).toBe("main.rs");
    expect(filenameFor("cpp")).toBe("code.cpp");
  });
});

describe("Project generation", () => {
  it("parses file blocks exactly", () => {
    const files = parseFileBlocks("=== FILE: index.html ===\n<h1>Hi</h1>\n=== FILE: css/styles.css ===\n```css\nh1{color:red}\n```\n");
    expect(files.map((f) => f.path)).toEqual(["index.html", "css/styles.css"]);
    expect(files[1].content).toBe("h1{color:red}\n");
  });

  it("scaffolds every required React + TS + Vite file", () => {
    const files = scaffold("react-ts-vite", "Shop", [{ path: "src/main.tsx", content: 'import App from "./App";\n' }, { path: "src/App.tsx", content: "export default function App(){return <div/>}\n" }]);
    const paths = files.map((f) => f.path);
    for (const req of STACKS["react-ts-vite"].required) expect(paths).toContain(req);
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.devDependencies.vite).toBeTruthy();
  });

  it("validates a working multi-page site with no errors", () => {
    const nav = '<nav><a href="index.html">Home</a><a href="about.html">About</a></nav>';
    const files = scaffold("html-site", "Site", [
      { path: "index.html", content: `<html><head><title>Home</title><link href="css/styles.css" rel="stylesheet"></head><body>${nav}<script src="js/main.js"></script></body></html>` },
      { path: "about.html", content: `<html><head><title>About</title></head><body>${nav}</body></html>` },
      { path: "css/styles.css", content: "body{margin:0}" },
      { path: "js/main.js", content: "console.log('ok');" },
    ]);
    const r = validateProject("html-site", files);
    expect(r.errors).toEqual([]);
    expect(r.notChecked.join(" ")).toMatch(/build/i);
  });

  it("finds syntax errors, broken imports, broken links and missing packages", () => {
    const files = scaffold("react-ts-vite", "App", [
      { path: "src/main.tsx", content: 'import App from "./App";\nimport x from "./missing";\nimport axios from "axios";\n' },
      { path: "src/App.tsx", content: "export default function App( { return <div/> }\n" },
    ]);
    const msgs = validateProject("react-ts-vite", files).errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/Syntax error/);
    expect(msgs).toMatch(/"\.\/missing"/);
    expect(msgs).toMatch(/axios/);
    const html = validateProject("html-site", [{ path: "index.html", content: '<title>x</title><a href="nope.html">x</a>' }, { path: "README.md", content: "x" }]);
    expect(html.errors.some((e) => /nope\.html/.test(e.message))).toBe(true);
  });

  it("packs a project under one root, excludes secrets and verifies contents", () => {
    const files = [{ path: "index.html", content: "<p>x</p>\n" }, { path: ".env", content: "KEY=1" }, { path: "node_modules/a.js", content: "x" }];
    const pack = packProject("site", files);
    expect(pack.included).toEqual(["index.html"]);
    expect(pack.excluded).toEqual([".env", "node_modules/a.js"]);
    expect(verifyPack(pack.bytes, "site", files, pack.included)).toEqual([]);
    expect(strFromU8(unzipSync(pack.bytes)["site/index.html"])).toBe("<p>x</p>\n");
  });
});

describe("ZIP analysis", () => {
  it("produces inventory, instructions, findings and docs without running code", () => {
    const bytes = zipSync({
      "app/package.json": strToU8(JSON.stringify({ scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "18" }, devDependencies: { vite: "5" } })),
      "app/src/main.jsx": strToU8('import App from "./App";'),
      "app/.env": strToU8("SECRET=1"),
      "app/src/config.js": strToU8('const api_key = "abcdefghijklmnop123";'),
    });
    const r = readArchiveSafely(bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = analyzeProject("app.zip", r.entries, r.skippedText);
    expect(a.root).toBe("app");
    expect(a.stack).toContain("React");
    expect(a.instructions.build).toBe("npm run build");
    expect(a.findings.some((f) => f.title === "Environment file included")).toBe(true);
    expect(a.findings.some((f) => f.title === "Possible secret in source")).toBe(true);
    expect(documentationMarkdown(a)).toContain("## Getting started");
    expect(reportMarkdown(a)).toContain("## Findings");
  });
});

describe("Status recovery", () => {
  it("marks a silent running job as failed, leaves fresh and finished jobs alone", () => {
    const now = Date.now();
    expect(recoveredStatus("generating", new Date(now - STALE_AFTER_MS - 1000).toISOString(), now)).toBe("failed");
    expect(recoveredStatus("generating", new Date(now - 1000).toISOString(), now)).toBe("generating");
    expect(recoveredStatus("completed", new Date(0).toISOString(), now)).toBe("completed");
  });
});
