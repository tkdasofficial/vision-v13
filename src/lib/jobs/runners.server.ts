// Job runners: each step reports a real operation. Nothing here installs, builds or executes user code.
import { strToU8 } from "fflate";
import { filenameFor, extensionFor } from "@/lib/code-files";
import { STACKS, scaffold, parseFileBlocks, projectSlug, type GenFile, type Stack } from "@/lib/builder/stacks";
import { validateProject, syntaxCheck, type ValidationReport } from "@/lib/builder/validate";
import { packProject, verifyPack, readArchiveSafely } from "@/lib/builder/archive";
import { analyzeProject, documentationMarkdown, reportMarkdown } from "@/lib/builder/analyze";
import { complete } from "./llm.server";
import type { JobRun } from "./jobs.server";

export const MAX_REPAIR_ATTEMPTS = 2;
const MIME: Record<string, string> = { html: "text/html", css: "text/css", js: "text/javascript", ts: "text/plain", json: "application/json", md: "text/markdown", py: "text/x-python" };

// ---------- Single-file code ----------
export type CodeInput = { prompt?: string; language?: string; filename?: string; code?: string };

export async function runCodeExport(job: JobRun, input: CodeInput) {
  let code = input.code;
  let language = (input.language || "").toLowerCase();
  if (!code) {
    if (!input.prompt?.trim()) throw new Error("Describe the code you want.");
    await job.step("generating", "Writing the code");
    const { text, model } = await complete(
      "You write complete, working source code. Reply with exactly one fenced code block tagged with its language, optionally preceded by one line `FILENAME: name.ext`. No explanation.",
      `${language ? `Language: ${language}\n` : ""}${input.prompt.slice(0, 8000)}`,
    );
    const fence = text.match(/```([\w+#-]*)\r?\n([\s\S]*?)```/);
    code = (fence ? fence[2] : text).replace(/\s+$/, "") + "\n";
    language ||= fence?.[1]?.toLowerCase() || "txt";
    input.filename ||= text.match(/FILENAME:\s*([\w.\-/]+)/)?.[1];
    job.markCurrent("ok");
    void model;
  }
  const fileName = filenameFor(language, input.filename);
  await job.step("validating", `Checking ${fileName}`);
  const ext = (fileName.split(".").pop() ?? "txt").toLowerCase();
  if (/^(m?js|cjs|jsx|ts|tsx)$/.test(ext)) {
    const d = syntaxCheck(fileName, code);
    if (d) { job.warn(`${d.message}${d.line ? ` (line ${d.line})` : ""}`); job.markCurrent("warn"); }
  } else if (ext === "json") {
    try { JSON.parse(code); } catch (e: any) { job.warn(`Invalid JSON: ${e.message}`); job.markCurrent("warn"); }
  } else {
    job.warn(`No syntax checker for .${ext} files here; the code was not checked.`);
  }
  await job.step("saving", `Saving ${fileName}`);
  const art = await job.saveArtifact(fileName, MIME[ext] ?? "text/plain", strToU8(code), "file");
  await job.finish({ prompt: input.prompt, fileName, language: language || extensionFor(language), content: code, artifactId: art.id });
}

// ---------- Multi-file project ----------
export type ProjectInput = { prompt: string; stack?: Stack; name?: string };

export function inferStack(prompt: string): Stack {
  const p = prompt.toLowerCase();
  if (/\bpython|flask|fastapi|django\b/.test(p)) return "python";
  if (/\b(node|express)\b/.test(p) && !/react/.test(p)) return "node";
  if (/react/.test(p)) return /javascript|\bjs\b/.test(p) && !/typescript|\bts\b/.test(p) ? "react-js-vite" : "react-ts-vite";
  return "html-site";
}

const genSystem = (stack: Stack) => `You generate complete multi-file projects. Stack: ${STACKS[stack].label}. ${STACKS[stack].guide}
Output every file as:
=== FILE: relative/path.ext ===
<full file content>
Rules: write every file in full (no placeholders, no "..."), include README.md, keep code runnable, only import files you also output or packages you list in package.json. No text outside file blocks.`;

export async function runProjectGenerate(job: JobRun, input: ProjectInput) {
  if (!input.prompt?.trim()) throw new Error("Describe the project you want.");
  const stack = input.stack && STACKS[input.stack] ? input.stack : inferStack(input.prompt);
  const name = (input.name?.trim() || input.prompt.split(/[.,\n]/)[0]).slice(0, 60);
  const root = projectSlug(name);

  await job.step("planning", `Planning a ${STACKS[stack].label} project`);
  await job.step("generating", "Generating project files");
  const { text } = await complete(genSystem(stack), `Project name: ${name}\nRequest:\n${input.prompt.slice(0, 8000)}`, { maxTokens: 12000 });
  let files = parseFileBlocks(text);
  if (!files.length) throw new Error("The AI reply contained no files. Please try again.");

  await job.step("writing_files", `Writing ${files.length} files and configuration`);
  files = scaffold(stack, name, files);

  let report: ValidationReport = validateProject(stack, files);
  await job.step("validating", `Checked: ${report.checked.join(", ")}`);
  for (let attempt = 1; report.errors.length && attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    job.markCurrent("error");
    await job.step("fixing", `Repair attempt ${attempt} of ${MAX_REPAIR_ATTEMPTS}: ${report.errors.length} problem(s)`);
    const broken = [...new Set(report.errors.map((e) => e.path))];
    const ctx = broken.map((p) => { const f = files.find((x) => x.path === p); return `=== FILE: ${p} ===\n${f ? f.content : "(missing — create it)"}`; }).join("\n");
    const list = files.map((f) => f.path).join("\n");
    const { text: fixText } = await complete(genSystem(stack), `These problems were found by automated checks:\n${report.errors.map((e) => `- ${e.path}${e.line ? `:${e.line}` : ""}: ${e.message}`).join("\n")}\n\nProject files:\n${list}\n\nCurrent content of the affected files:\n${ctx}\n\nReturn corrected full versions of only the files you change (you may add missing files).`);
    const fixes = parseFileBlocks(fixText);
    const map = new Map(files.map((f) => [f.path, f]));
    for (const f of fixes) map.set(f.path, f);
    files = scaffold(stack, name, [...map.values()]);
    await job.step("running_checks", "Re-running checks");
    report = validateProject(stack, files);
  }
  if (report.errors.length) {
    job.markCurrent("error");
    for (const e of report.errors.slice(0, 20)) job.warn(`Unresolved: ${e.path}${e.line ? `:${e.line}` : ""} — ${e.message}`);
  }
  for (const w of report.warnings.slice(0, 10)) job.warn(`${w.path}: ${w.message}`);
  job.warn("Not built or tested: no build environment is connected, so only static checks ran.");

  await job.step("packaging", "Packaging ZIP");
  const pack = packProject(root, files);
  await job.step("verifying", "Reopening the ZIP to confirm every file");
  const problems = verifyPack(pack.bytes, root, files, pack.included);
  if (problems.length) throw new Error(`ZIP verification failed: ${problems[0]}`);
  await job.step("saving", "Saving download");
  const art = await job.saveArtifact(`${root}.zip`, "application/zip", pack.bytes, "zip");

  const framework = stack === "html-site" ? "vanilla-html" : stack.startsWith("react") ? "react-vite" : "vanilla-html";
  await job.finish({
    prompt: input.prompt, stack, stackLabel: STACKS[stack].label, name, root, artifactId: art.id,
    files: files.map((f) => ({ path: f.path, size: f.content.length })),
    excluded: pack.excluded,
    validation: { errors: report.errors, warnings: report.warnings, checked: report.checked, notChecked: report.notChecked },
    webApp: { files: files.map((f) => ({ path: f.path, content: f.content.slice(0, 200_000) })), framework, dependencies: {}, entryPoint: "index.html", explanation: "" },
  });
}

// ---------- ZIP analysis ----------
export async function runZipAnalyze(job: JobRun, input: { fileName: string; bytes: Uint8Array }) {
  await job.step("scanning", "Checking paths, sizes and compression ratios");
  const read = readArchiveSafely(input.bytes);
  if (!read.ok) throw new Error(read.issues.slice(0, 3).map((i) => `${i.message}${i.path ? ` (${i.path})` : ""}`).join(" "));
  await job.step("extracting", `Reading text files from ${read.entries.length} entries (nothing is run)`);
  await job.step("inspecting", "Inspecting manifests, structure and code");
  const analysis = analyzeProject(input.fileName, read.entries, read.skippedText);
  await job.step("analyzing", `Found ${analysis.findings.length} finding(s)`);
  for (const l of analysis.limitations.slice(2)) job.warn(l);

  await job.step("generating", "Writing documentation");
  let summary: string | undefined;
  try {
    const sample = read.entries.filter((e) => e.text && /readme|package\.json|main\.|index\.|app\./i.test(e.path)).slice(0, 6).map((e) => `--- ${e.path}\n${e.text!.slice(0, 2500)}`).join("\n");
    const { text } = await complete("You summarize software projects in 3-5 plain sentences for documentation. State only what the files show; say when something is unclear.", `Stack: ${analysis.stack.join(", ")}\nTree:\n${analysis.tree.slice(0, 3000)}\n\nKey files:\n${sample}`, { maxTokens: 600 });
    summary = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 2000) || undefined;
  } catch { job.warn("AI summary unavailable; documentation was generated from static analysis only."); }
  const docs = documentationMarkdown(analysis, summary);
  const report = reportMarkdown(analysis);

  await job.step("packaging", "Packaging documentation and report");
  const base = projectSlug(analysis.name);
  const outFiles: GenFile[] = [
    { path: "PROJECT_DOCUMENTATION.md", content: docs },
    { path: "ANALYSIS_REPORT.md", content: report },
    { path: "inventory.json", content: JSON.stringify({ inventory: analysis.inventory, stack: analysis.stack, entryPoints: analysis.entryPoints, scripts: analysis.scripts, findings: analysis.findings }, null, 2) },
  ];
  const pack = packProject(`${base}-analysis`, outFiles);
  await job.step("verifying", "Reopening the report ZIP");
  const problems = verifyPack(pack.bytes, `${base}-analysis`, outFiles, pack.included);
  if (problems.length) throw new Error(`Report verification failed: ${problems[0]}`);
  await job.step("saving", "Saving report");
  const art = await job.saveArtifact(`${base}-analysis.zip`, "application/zip", pack.bytes, "report");
  await job.finish({ fileName: input.fileName, artifactId: art.id, analysis: { ...analysis, tree: analysis.tree.slice(0, 20000) }, documentation: docs, report });
}
