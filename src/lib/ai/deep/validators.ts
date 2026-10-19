// Deterministic validators for Deep Thinking Mode candidates. Pure; never relies on the model's self-assessment.
import type { RequestAnalysis } from "./analyze";
import { planDurations } from "./durations";
import { checkInstructions } from "./instructions";
import { checkPlot } from "./plot";

/** `items` lists the affected section numbers when the problem is local, enabling targeted correction. */
export type Issue = { code: string; message: string; items?: number[] };

const NUMBER_WORDS = "\\d{1,4}";

/** "1-3, 7, 9-12" — keeps messages short for large outputs while naming every number. */
export function ranges(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b), out: string[] = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`); i = j; }
  return out.join(", ");
}

/** Numbers of the top-level outputs, in the order they appear. Prefers labelled items ("Scene 3"). */
export function extractItemNumbers(text: string, noun?: string): number[] {
  const body = text.replace(/```[\s\S]*?```/g, (m) => (/^```json/i.test(m) ? m : "")); // ignore code bodies except JSON
  if (noun) {
    const re = new RegExp(`^\\s{0,3}(?:#{1,6}\\s*)?(?:[*_]{1,2})?${noun}s?\\s*#?(${NUMBER_WORDS})\\b`, "gim");
    const nums = [...body.matchAll(re)].map((m) => Number(m[1]));
    if (nums.length) return nums;
  }
  const re = /^(?:#{1,6}\s*)?(?:[*_]{1,2})?(\d{1,3})[.)]\s+\S/gm;
  return [...body.matchAll(re)].map((m) => Number(m[1]));
}

/** Missing, duplicated and out-of-order numbers against 1..expected. */
export function checkSequence(nums: number[], expected: number): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<number>();
  const dups = new Set<number>();
  for (const n of nums) (seen.has(n) ? dups : seen).add(n);
  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !seen.has(n));
  const extra = [...seen].filter((n) => n < 1 || n > expected).sort((a, b) => a - b);
  if (missing.length) issues.push({ code: "missing", items: missing, message: `Missing item(s): ${ranges(missing)}.` });
  if (dups.size) issues.push({ code: "duplicate", message: `Duplicated item(s): ${ranges([...dups])}.` });
  if (extra.length) issues.push({ code: "extra", message: `Unrequested extra item(s): ${ranges(extra)} (only ${expected} requested).` });
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] < nums[i - 1]) { issues.push({ code: "order", message: `Items are out of order (${nums[i - 1]} appears before ${nums[i]}).` }); break; }
  }
  return issues;
}

export function checkJson(text: string): Issue[] {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  const src = fenced ? fenced[1] : text.trim();
  if (!fenced && !/^[[{]/.test(src)) return [{ code: "json_missing", message: "JSON was requested but no JSON block was found." }];
  try { JSON.parse(src); return []; } catch (e: any) { return [{ code: "json_invalid", message: `The JSON is invalid: ${String(e?.message ?? e).slice(0, 120)}.` }]; }
}

/** Per-item durations written as "Duration: 6s" / "(8 seconds)" / "0:00–0:06". */
export function extractDurations(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\bduration\b[^\d\n]{0,15}(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?\b/gi)) out.push(Number(m[1]));
  return out;
}

export function checkDurations(text: string, a: RequestAnalysis): Issue[] {
  if (!a.allowedDurations) return [];
  const d = extractDurations(text);
  if (!d.length) return [{ code: "duration_missing", message: `Each clip must state its duration as "Duration: Ns" using only ${a.allowedDurations.join("/")} seconds.` }];
  const issues: Issue[] = [];
  const bad = d.filter((v) => !a.allowedDurations!.includes(v));
  if (bad.length) issues.push({ code: "duration_unsupported", message: `Unsupported clip duration(s): ${bad.join(", ")}s. Allowed: ${a.allowedDurations.join(", ")}s.` });
  if (a.totalDuration) {
    const feasible = planDurations(Math.round(a.totalDuration), a.allowedDurations, a.items?.noun === "scene" || a.items?.noun === "clip" ? a.items.count : undefined);
    const sum = d.reduce((x, y) => x + y, 0);
    if (feasible && Math.abs(sum - a.totalDuration) > 0.01) issues.push({ code: "duration_total", message: `Clip durations sum to ${sum}s but the audio is ${a.totalDuration}s.` });
    if (!feasible && !/\b(not possible|impossible|cannot|can't|mismatch|conflict)\b/i.test(text)) {
      issues.push({ code: "duration_conflict_hidden", message: `A ${a.totalDuration}s total cannot be built exactly from ${a.allowedDurations.join("/")}s clips; the answer must state this conflict and offer feasible alternatives.` });
    }
  }
  return issues;
}

/** Truncation signs: provider stopped for length or a code fence was left open. */
export function checkComplete(text: string, finishReason: string | null): Issue[] {
  const issues: Issue[] = [];
  if (finishReason === "length") issues.push({ code: "truncated", message: "The response was cut off by the output limit." });
  if (((text.match(/```/g) ?? []).length) % 2 === 1) issues.push({ code: "open_fence", message: "A code block is not closed." });
  if (!text.trim()) issues.push({ code: "empty", message: "The response is empty." });
  return issues;
}

export function validateCandidate(text: string, a: RequestAnalysis, finishReason: string | null = "stop"): Issue[] {
  const issues = [...checkComplete(text, finishReason)];
  // Unlabelled text units (paragraphs etc.) are counted as blank-line blocks instead of numbered labels.
  if (a.items && (/^(paragraph|sentence|line|verse|stanza)s?$/i.test(a.items.noun) || a.instructions?.noHeadings) && !extractItemNumbers(text, a.items.noun).length) {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b && !/^>/.test(b) && !/^#{1,6}\s/.test(b));
    if (/^paragraphs?$/i.test(a.items.noun) && blocks.length !== a.items.count) issues.push({ code: "count", message: `Expected exactly ${a.items.count} paragraphs; found ${blocks.length}.` });
  } else if (a.items) issues.push(...checkSequence(extractItemNumbers(text, a.items.noun), a.items.count));
  if (a.wantsJson) issues.push(...checkJson(text));
  issues.push(...checkDurations(text, a));
  if (a.inputs?.length) issues.push(...checkInputs(text, a.inputs));
  issues.push(...checkStructure(text));
  issues.push(...checkContinuity(text));
  // Whole-story plot check: every scene is read together, not one at a time.
  if (a.items && /^(scene|prompt|clip|shot|part|chapter|panel|episode|beat)s?$/i.test(a.items.noun)) issues.push(...checkPlot(text, a.items.noun));
  if (a.instructions) issues.push(...checkInstructions(text, a.instructions, a.items?.noun ?? null));
  return issues;
}

/** The figures the user gave must still be the ones used: an answer that silently swaps 6% for 9.569% fails. */
export function checkInputs(text: string, inputs: string[]): Issue[] {
  const flat = text.replace(/\{,\}|,|\\[,;! ]|\\%/g, (m) => (m.includes("%") ? "%" : "")).replace(/\s+%/g, "%");
  const missing = inputs.filter((v) => {
    if (v.endsWith("%")) { const n = Number(v.slice(0, -1)); return !new RegExp(`(?<![\\d.])${v.slice(0, -1).replace(".", "\\.")}%`).test(flat) && !flat.includes(String(n / 100)); }
    return !new RegExp(`(?<!\\d)${v}(?!\\d)`).test(flat);
  });
  return missing.length ? [{ code: "inputs_changed", message: `The answer must use the figures the user gave (${missing.join(", ")}); do not replace them with other values. Recalculate every result from the original inputs.` }] : [];
}

/** Scene continuity: when scenes state "Ending state:" / "Starting state:", each start must match the previous end. */
export function checkContinuity(text: string): Issue[] {
  const parts = text.split(/(?=^\s*(?:#{1,6}\s*)?\**scene\s+\d+)/im).filter((p) => /^\s*(?:#{1,6}\s*)?\**scene\s+\d+/i.test(p));
  const get = (p: string, k: string) => (new RegExp(`${k}\\s*state\\**\\s*:\\**\\s*(.+)`, "i").exec(p)?.[1] ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const issues: Issue[] = [];
  for (let i = 1; i < parts.length; i++) {
    const end = get(parts[i - 1], "end(?:ing)?"), start = get(parts[i], "start(?:ing)?");
    if (!end || !start) continue;
    const ew = new Set(end.split(" ").filter((w) => w.length > 3)), sw = start.split(" ").filter((w) => w.length > 3);
    const overlap = sw.filter((w) => ew.has(w)).length / Math.max(1, Math.min(ew.size, sw.length));
    if (overlap < 0.3) issues.push({ code: "continuity", items: [i + 1], message: `Scene ${i + 1} starts with "${start}" but scene ${i} ended with "${end}".` });
  }
  return issues;
}

/** GFM tables outside code fences: column counts, duplicate rows and "Total" rows that don't add up. */
export function checkTables(text: string): Issue[] {
  const issues: Issue[] = [];
  const body = text.replace(/```[\s\S]*?```/g, "");
  const blocks = body.match(/(?:^[ \t]*\|.*\|[ \t]*(?:\n|$)){2,}/gm) ?? [];
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
  blocks.forEach((b, bi) => {
    const lines = b.trim().split("\n");
    if (lines.length < 2 || !/^\s*\|?\s*:?-{2,}/.test(lines[1])) return;
    const head = cells(lines[0]), rows = lines.slice(2).map(cells);
    const name = `Table ${bi + 1}`;
    const bad = rows.map((r, i) => (r.length !== head.length ? i + 1 : 0)).filter(Boolean);
    if (bad.length) issues.push({ code: "table_columns", message: `${name}: row(s) ${bad.join(", ")} don't have ${head.length} cells.` });
    const seen = new Set<string>(), dups: number[] = [];
    rows.forEach((r, i) => { const k = r.join("|").toLowerCase(); if (/^[\s*$€£₹\\-]*-?[\d.,]+[\s*]*$/.test(r[0] ?? "")) return; /* data rows (2, 4, 4, 4…) legitimately repeat */ if (k.replace(/\|/g, "").trim() && seen.has(k)) dups.push(i + 1); seen.add(k); });
    if (dups.length) issues.push({ code: "table_duplicate", message: `${name}: duplicate row(s) ${dups.join(", ")}.` });
    const num = (s: string) => { const v = s.replace(/[*_$€£₹,%\s]/g, ""); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN; };
    const ti = rows.findIndex((r) => /^\**\s*(grand\s+)?total\s*\**$/i.test(r[0] ?? ""));
    if (ti > 0) {
      for (let c = 1; c < head.length; c++) {
        const vals = rows.slice(0, ti).map((r) => num(r[c] ?? ""));
        const tot = num(rows[ti][c] ?? "");
        if (!Number.isFinite(tot) || vals.some((v) => !Number.isFinite(v)) || /%|avg|average|rate|price|per/i.test(head[c])) continue;
        const sum = vals.reduce((x, y) => x + y, 0);
        if (Math.abs(sum - tot) > Math.max(0.011, Math.abs(sum) * 0.005)) issues.push({ code: "table_total", message: `${name}: "${head[c]}" total is ${tot} but the rows add up to ${Math.round(sum * 100) / 100}.` });
      }
    }
  });
  return issues;
}

/** Static checks for fenced code: JSON must parse; brackets must balance in C-like code; HTML documents must close. */
export function checkCode(text: string): Issue[] {
  const issues: Issue[] = [];
  for (const m of text.matchAll(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g)) {
    const lang = m[1].toLowerCase(), src = m[2];
    if (lang === "json") { try { JSON.parse(src); } catch (e: any) { issues.push({ code: "code_json", message: `A JSON block doesn't parse: ${String(e?.message ?? e).slice(0, 100)}.` }); } continue; }
    if (["html", "htm"].includes(lang)) {
      if (/<html[\s>]/i.test(src) && !/<\/html>/i.test(src)) issues.push({ code: "code_html", message: "An HTML document is missing its closing </html> tag." });
      continue;
    }
    if (!["js", "javascript", "ts", "typescript", "jsx", "tsx", "java", "c", "cpp", "c++", "cs", "csharp", "go", "rust", "rs", "kotlin", "swift", "php", "css", "scss"].includes(lang)) continue;
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
    const stack: string[] = []; const pair: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    let broken = false;
    for (const ch of stripped) { if ("([{".includes(ch)) stack.push(ch); else if (ch in pair) { if (stack.pop() !== pair[ch]) { broken = true; break; } } }
    if (broken || stack.length) issues.push({ code: "code_brackets", message: `A ${lang} code block has unbalanced brackets.` });
  }
  return issues;
}

export function checkStructure(text: string): Issue[] {
  return [...checkTables(text), ...checkCode(text)];
}
