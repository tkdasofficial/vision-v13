import { supabase } from "@/lib/cloud/client";

export type GeneratedFile = {
  path: string;
  content: string;
};

export type WebAppProject = {
  framework: "react-vite" | "nextjs-static" | "vanilla-html";
  files: GeneratedFile[];
  dependencies: Record<string, string>;
  entryPoint: string;
  explanation: string;
};

export type CompileResult = {
  success: boolean;
  html?: string;
  error?: string;
  errors?: string[];
  warnings?: string[];
  compiledFiles?: number;
  bundleSize?: number;
};

/**
 * Compile project files using the backend esbuild compiler.
 * Falls back to client-side preview if backend fails.
 */
export async function compileProject(
  files: GeneratedFile[],
  framework: string,
  dependencies: Record<string, string> = {},
  entryPoint?: string,
  onProgress?: (step: string) => void,
): Promise<CompileResult> {
  onProgress?.("Sending to compiler...");

  try {
    const { data, error } = await supabase.functions.invoke("compile-tsx", {
      body: { files, framework, dependencies, entryPoint },
    });

    if (error) {
      console.error("Backend compile failed:", error);
      onProgress?.("Compilation failed");
      return { success: false, error: error.message || "Backend compilation failed" };
    }

    if (data?.success && data?.html) {
      onProgress?.("Compilation complete");
      return {
        success: true,
        html: data.html,
        compiledFiles: data.compiledFiles,
        bundleSize: data.bundleSize,
        warnings: data.warnings,
      };
    }

    if (data?.errors?.length) {
      console.error("Compile errors:", data.errors);
      return {
        success: false,
        error: data.errors.join("\n"),
        errors: data.errors,
        warnings: data.warnings,
      };
    }

    return { success: false, error: "Unknown compilation error" };
  } catch (err: any) {
    console.error("Compile request failed:", err);
    return { success: false, error: err.message || "Network error during compilation" };
  }
}

/**
 * Client-side preview builder (kept as utility, not used for primary compilation).
 */
export function buildPreviewHTML(
  files: GeneratedFile[],
  framework: string,
  dependencies: Record<string, string> = {}
): string {
  const base = (() => {
    switch (framework) {
      case "react-vite":
      case "nextjs-static":
        return buildReactPreview(files, dependencies);
      case "vanilla-html":
      default:
        return buildVanillaPreview(files);
    }
  })();

  return injectRuntimeHelpers(base);
}

/**
 * Inject console capture and error overlay into preview HTML.
 * Posts messages to parent via postMessage.
 */
function injectRuntimeHelpers(html: string): string {
  const helperScript = `
<script>
(function() {
  const _origLog = console.log;
  const _origWarn = console.warn;
  const _origError = console.error;
  function relay(level, args) {
    try {
      const msg = Array.from(args).map(a => {
        if (typeof a === 'object') try { return JSON.stringify(a, null, 2); } catch { return String(a); }
        return String(a);
      }).join(' ');
      window.parent.postMessage({ type: 'console', level, message: msg }, '*');
    } catch {}
  }
  console.log = function() { relay('log', arguments); _origLog.apply(console, arguments); };
  console.warn = function() { relay('warn', arguments); _origWarn.apply(console, arguments); };
  console.error = function() { relay('error', arguments); _origError.apply(console, arguments); };

  window.onerror = function(msg, src, line, col, err) {
    const detail = err?.stack || msg;
    relay('error', [detail]);
    showErrorOverlay(String(msg), line, src);
  };
  window.addEventListener('unhandledrejection', function(e) {
    const msg = e.reason?.stack || e.reason?.message || String(e.reason);
    relay('error', [msg]);
    showErrorOverlay(msg);
  });

  function showErrorOverlay(message, line, source) {
    if (document.getElementById('__err_overlay')) return;
    const d = document.createElement('div');
    d.id = '__err_overlay';
    d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40%;overflow:auto;background:#1e1e2e;color:#f38ba8;font-family:monospace;font-size:12px;padding:12px 16px;z-index:999999;border-top:2px solid #f38ba8;';
    d.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#fab387">⚠ Runtime Error</b><button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#6c7086;cursor:pointer;font-size:16px">✕</button></div><pre style="margin:0;white-space:pre-wrap;word-break:break-word">' + message.replace(/</g,'&lt;') + '</pre>' + (line ? '<div style="color:#6c7086;margin-top:4px">Line ' + line + (source ? ' in ' + source : '') + '</div>' : '');
    document.body.appendChild(d);
  }
})();
<\/script>`;

  if (html.includes("</head>")) {
    return html.replace("</head>", helperScript + "\n</head>");
  }
  return helperScript + html;
}

function buildVanillaPreview(files: GeneratedFile[]): string {
  const htmlFile = files.find(
    (f) => f.path === "index.html" || f.path.endsWith("/index.html")
  );

  if (htmlFile) {
    let html = htmlFile.content;

    const cssFiles = files.filter((f) => f.path.endsWith(".css"));
    for (const css of cssFiles) {
      const linkPattern = new RegExp(
        `<link[^>]*href=["'](?:\\./)?${escapeRegex(css.path)}["'][^>]*>`,
        "gi"
      );
      html = html.replace(linkPattern, `<style>${css.content}</style>`);
    }

    const jsFiles = files.filter(
      (f) => f.path.endsWith(".js") || f.path.endsWith(".ts")
    );
    for (const js of jsFiles) {
      const scriptPattern = new RegExp(
        `<script[^>]*src=["'](?:\\./)?${escapeRegex(js.path)}["'][^>]*>\\s*</script>`,
        "gi"
      );
      html = html.replace(scriptPattern, `<script>${js.content}</script>`);
    }

    if (!html.includes("<style>") && cssFiles.length > 0) {
      const styles = cssFiles.map((f) => `<style>${f.content}</style>`).join("\n");
      html = html.replace("</head>", `${styles}\n</head>`);
    }

    if (jsFiles.length > 0) {
      const unlinkedJS = jsFiles.filter((f) => !html.includes(f.content));
      if (unlinkedJS.length > 0) {
        const scripts = unlinkedJS.map((f) => `<script>${f.content}</script>`).join("\n");
        html = html.replace("</body>", `${scripts}\n</body>`);
      }
    }

    return html;
  }

  const cssContent = files.filter((f) => f.path.endsWith(".css")).map((f) => f.content).join("\n");
  const jsContent = files.filter((f) => f.path.endsWith(".js") || f.path.endsWith(".ts")).map((f) => f.content).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>${cssContent}</style>
</head>
<body>
  <script>${jsContent}<\/script>
</body>
</html>`;
}

function buildReactPreview(
  files: GeneratedFile[],
  dependencies: Record<string, string>
): string {
  const appFile = files.find(
    (f) =>
      f.path === "src/App.tsx" ||
      f.path === "src/App.jsx" ||
      f.path === "App.tsx" ||
      f.path === "App.jsx"
  );

  const cssFiles = files.filter((f) => f.path.endsWith(".css"));
  const allStyles = cssFiles.map((f) => f.content).join("\n");

  const importMap: Record<string, string> = {
    "react": "https://esm.sh/react@18?dev",
    "react-dom": "https://esm.sh/react-dom@18?dev",
    "react-dom/client": "https://esm.sh/react-dom@18/client?dev",
    "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime?dev",
    "react-router-dom": "https://esm.sh/react-router-dom@6?dev&deps=react@18,react-dom@18",
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2",
  };

  for (const [pkg, version] of Object.entries(dependencies)) {
    if (!importMap[pkg]) {
      const ver = version.replace(/[\^~]/, "");
      importMap[pkg] = `https://esm.sh/${pkg}@${ver}?deps=react@18,react-dom@18`;
    }
  }

  const moduleFiles = files.filter(
    (f) =>
      !f.path.endsWith(".css") &&
      !f.path.endsWith(".html") &&
      !f.path.endsWith(".json") &&
      !f.path.endsWith(".md")
  );

  const appCode = appFile ? stripTypeScript(appFile.content) : "";

  const componentFiles = moduleFiles.filter(
    (f) => f !== appFile && !f.path.includes("main.")
  );

  const componentRegistrations = componentFiles.map((f) => {
    const code = stripTypeScript(f.content);
    const modulePath = f.path.replace(/^src\//, "./").replace(/\.(tsx?|jsx?)$/, "");
    return { path: modulePath, code, originalPath: f.path };
  });

  const componentSetup = componentRegistrations.map((c) => {
    const varName = c.originalPath
      .replace(/^src\//, "")
      .replace(/\.(tsx?|jsx?)$/, "")
      .replace(/[\/\-\.]/g, "_");
    return `
// --- ${c.originalPath} ---
const __module_${varName} = (function() {
  ${c.code}
  return { ${extractExportNames(c.code).join(", ")} };
})();`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script type="importmap">
  ${JSON.stringify({ imports: importMap }, null, 2)}
  <\/script>
  <style>${allStyles}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React, { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext } from 'react';
    import { createRoot } from 'react-dom/client';
    import { HashRouter, Routes, Route, Link, NavLink, useNavigate, useParams, useLocation, Navigate, Outlet } from 'react-router-dom';

    ${componentSetup}

    ${appCode}

    const AppComponent = typeof App !== 'undefined' ? App :
                         typeof Default !== 'undefined' ? Default :
                         () => React.createElement('div', { style: { padding: '2rem', textAlign: 'center' } }, 'No App component found');

    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(AppComponent));
  <\/script>
</body>
</html>`;
}

/**
 * Extract exported names from stripped code for module namespace.
 */
function extractExportNames(code: string): string[] {
  const names: string[] = [];
  const patterns = [
    /(?:const|let|var)\s+(\w+)\s*=/g,
    /function\s+(\w+)/g,
    /class\s+(\w+)/g,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(code)) !== null) {
      if (m[1] && !m[1].startsWith("_") && m[1][0] === m[1][0].toUpperCase()) {
        names.push(m[1]);
      }
    }
  }
  return [...new Set(names)];
}

/**
 * Strip TypeScript-specific syntax so code runs in the browser.
 */
function stripTypeScript(code: string): string {
  let result = code;

  result = result.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, "");
  result = result.replace(/^import\s+['"].*?['"];?\s*$/gm, "");
  result = result.replace(/^import\s+type\s+.*$/gm, "");

  result = result.replace(/^export\s+default\s+/gm, "");

  result = result.replace(/^export\s+(?=(?:const|let|var|function|class|type|interface|enum))/gm, "");

  result = result.replace(/^export\s*\{[^}]*\};?\s*$/gm, "");

  result = result.replace(/^(?:export\s+)?type\s+\w+\s*=\s*[^;]*;/gm, "");
  result = result.replace(/^(?:export\s+)?interface\s+\w+\s*\{[^}]*\}/gm, "");

  result = result.replace(/:\s*(?:string|number|boolean|any|void|null|undefined|never|unknown|React\.\w+(?:<[^>]*>)?|\w+(?:<[^>]*>)?(?:\[\])?(?:\s*\|\s*(?:string|number|boolean|null|undefined|\w+))*)\s*(?=[=,;\)\]\}\n])/g, "");

  result = result.replace(/<(?:string|number|boolean|any|void|null|undefined|never|unknown|\w+)(?:\[\])?\s*(?:,\s*(?:string|number|boolean|any|void|null|undefined|never|unknown|\w+)(?:\[\])?)*>/g, "");

  result = result.replace(/\s+as\s+\w+(?:<[^>]*>)?/g, "");

  result = result.replace(/(\w)\!/g, "$1");

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
