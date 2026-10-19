// Project stacks: required files and deterministic scaffolding the model must not get wrong.
export type Stack = "html-site" | "react-ts-vite" | "react-js-vite" | "node" | "python";
export type GenFile = { path: string; content: string };

export const STACKS: Record<Stack, { label: string; required: string[]; guide: string }> = {
  "html-site": {
    label: "HTML/CSS/JS website",
    required: ["index.html", "README.md"],
    guide: "Plain HTML, CSS and JavaScript. Each page is its own .html file at the project root, sharing css/styles.css and js/main.js. Every page has the same <nav> linking to every other page with relative links.",
  },
  "react-ts-vite": {
    label: "React + TypeScript + Vite",
    required: ["package.json", "index.html", "vite.config.ts", "tsconfig.json", "src/main.tsx", "src/App.tsx", "README.md"],
    guide: "React 18 + TypeScript + Vite + react-router-dom v6. Pages in src/pages/*.tsx, shared components in src/components/*.tsx, styles in src/index.css. Use relative imports without file extensions. Routing in src/App.tsx.",
  },
  "react-js-vite": {
    label: "React + JavaScript + Vite",
    required: ["package.json", "index.html", "vite.config.js", "src/main.jsx", "src/App.jsx", "README.md"],
    guide: "React 18 + JavaScript + Vite + react-router-dom v6. Pages in src/pages/*.jsx, components in src/components/*.jsx, styles in src/index.css.",
  },
  node: {
    label: "Node.js project",
    required: ["package.json", "README.md"],
    guide: "Node.js 20 ES modules. Source in src/, entry src/index.js, scripts start and test (node --test).",
  },
  python: {
    label: "Python project",
    required: ["README.md", "requirements.txt"],
    guide: "Python 3.11. Package code in app/, entry main.py, tests in tests/ using pytest, dependencies in requirements.txt.",
  },
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "vision-project";
export const projectSlug = slug;

/** Fills in configuration files the stack needs, keeping model-written ones unless they are unusable. */
export function scaffold(stack: Stack, name: string, files: GenFile[], extraDeps: Record<string, string> = {}): GenFile[] {
  const out = new Map(files.map((f) => [f.path, f]));
  const put = (path: string, content: string, overwriteInvalidJson = false) => {
    const cur = out.get(path);
    if (!cur) return out.set(path, { path, content });
    if (overwriteInvalidJson) { try { JSON.parse(cur.content); } catch { out.set(path, { path, content }); } }
  };
  const n = slug(name);
  if (stack === "react-ts-vite" || stack === "react-js-vite") {
    const ts = stack === "react-ts-vite";
    const pkg: any = {
      name: n, private: true, version: "1.0.0", type: "module",
      scripts: { dev: "vite", build: ts ? "tsc -b && vite build" : "vite build", preview: "vite preview" },
      dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.26.2", ...extraDeps },
      devDependencies: { "@vitejs/plugin-react": "^4.3.1", vite: "^5.4.8", ...(ts ? { typescript: "^5.6.2", "@types/react": "^18.3.10", "@types/react-dom": "^18.3.0" } : {}) },
    };
    // Keep model-added dependencies but force the core toolchain.
    const existing = out.get("package.json");
    if (existing) {
      try {
        const p = JSON.parse(existing.content);
        pkg.dependencies = { ...(p.dependencies ?? {}), ...pkg.dependencies };
        pkg.devDependencies = { ...(p.devDependencies ?? {}), ...pkg.devDependencies };
      } catch { /* replaced below */ }
    }
    out.set("package.json", { path: "package.json", content: JSON.stringify(pkg, null, 2) + "\n" });
    const main = ts ? "/src/main.tsx" : "/src/main.jsx";
    put("index.html", `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="${main}"></script>\n  </body>\n</html>\n`);
    put(ts ? "vite.config.ts" : "vite.config.js", `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });\n`);
    if (ts) {
      put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", useDefineForClassFields: true, lib: ["ES2020", "DOM", "DOM.Iterable"], module: "ESNext", skipLibCheck: true, moduleResolution: "bundler", allowImportingTsExtensions: true, isolatedModules: true, moduleDetection: "force", noEmit: true, jsx: "react-jsx", strict: true }, include: ["src"] }, null, 2) + "\n", true);
      put("src/vite-env.d.ts", `/// <reference types="vite/client" />\n`);
    }
  }
  if (stack === "node") put("package.json", JSON.stringify({ name: n, version: "1.0.0", type: "module", main: "src/index.js", scripts: { start: "node src/index.js", test: "node --test" }, dependencies: extraDeps }, null, 2) + "\n", true);
  if (stack === "python") put("requirements.txt", "\n");
  put(".gitignore", "node_modules\ndist\n.env\n__pycache__\n.venv\n");
  if (!out.has("README.md")) out.set("README.md", { path: "README.md", content: readme(stack, name) });
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function readme(stack: Stack, name: string) {
  const run: Record<Stack, string> = {
    "html-site": "Open `index.html` in a browser, or serve the folder:\n\n```bash\nnpx serve .\n```",
    "react-ts-vite": "```bash\nnpm install\nnpm run dev\nnpm run build\n```",
    "react-js-vite": "```bash\nnpm install\nnpm run dev\nnpm run build\n```",
    node: "```bash\nnpm install\nnpm start\nnpm test\n```",
    python: "```bash\npython -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython main.py\n```",
  };
  return `# ${name}\n\nStack: ${STACKS[stack].label}\n\n## Getting started\n\n${run[stack]}\n`;
}

/** Parses "=== FILE: path ===" blocks from model output. */
export function parseFileBlocks(text: string): GenFile[] {
  const files: GenFile[] = [];
  const re = /^===\s*FILE:\s*(.+?)\s*===\s*$/gm;
  const marks: { path: string; start: number; headStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) marks.push({ path: m[1].trim(), start: re.lastIndex, headStart: m.index });
  marks.forEach((mk, i) => {
    let body = text.slice(mk.start, i + 1 < marks.length ? marks[i + 1].headStart : undefined);
    body = body.replace(/^\r?\n/, "").replace(/\s*===\s*END\s*===\s*$/i, "");
    const fence = body.match(/^\s*```[\w+-]*\r?\n([\s\S]*?)\r?\n```\s*$/);
    if (fence) body = fence[1];
    files.push({ path: mk.path.replace(/^\.?\//, ""), content: body.replace(/\s+$/, "") + "\n" });
  });
  return files;
}
