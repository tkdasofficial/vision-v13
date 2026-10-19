// Structured, trackable requirements derived from the deep RequestAnalysis. Pure, tested.
import type { RequestAnalysis } from "./deep/analyze";

export type RequirementStatus = "pending" | "met" | "missing" | "conflicting" | "impossible";
export type Requirement = { id: string; text: string; mandatory: boolean; status: RequirementStatus };

export function buildRequirements(a: RequestAnalysis, text: string): Requirement[] {
  const r: Requirement[] = [];
  const add = (id: string, t: string, mandatory = true) => r.push({ id, text: t, mandatory, status: "pending" });
  if (a.items) add("count", `exactly ${a.items.count} ${a.items.noun}${a.items.count === 1 ? "" : "s"}`);
  if (a.wantsJson) add("json", "valid JSON output");
  if (a.allowedDurations) add("durations", `clip lengths only ${a.allowedDurations.join("/")}s`);
  if (a.totalDuration) add("total", `total length ${a.totalDuration}s`);
  const ins = a.instructions;
  if (ins?.words) add("words", `${ins.words.min ?? 0}-${ins.words.max ?? "∞"} words per ${ins.words.per}`);
  for (const s of ins?.scripts ?? []) add(`script:${s.part}`, `${s.part} in ${s.language ?? s.script} (${s.script})`);
  for (const n of ins?.requiredNames ?? []) add(`name:${n}`, `"${n}" named in every item`);
  if (ins?.noCommentary) add("no-commentary", "no extra commentary");
  if (ins?.consistency) add("consistency", "consistent characters and continuity", false);
  if (a.length !== "auto") add("length", `${a.length} answer`, false);
  if (/\b(table|tabular)\b/i.test(text)) add("table", "include a table", /\b(must|in a table|as a table)\b/i.test(text));
  return markConflicts(r, a);
}

/** Detects contradictory rules; the explicit numeric limit wins over a vague length preference. */
export function markConflicts(r: Requirement[], a: RequestAnalysis): Requirement[] {
  const w = a.instructions?.words;
  if (w?.min != null && w?.max != null && w.min > w.max) r.forEach((x) => x.id === "words" && (x.status = "impossible"));
  if (a.length === "detailed" && w?.max != null && w.per === "total" && w.max < 80) r.forEach((x) => x.id === "length" && (x.status = "conflicting"));
  if (a.length === "short" && a.items && a.items.count > 20) r.forEach((x) => x.id === "length" && (x.status = "conflicting"));
  return r;
}

/** Applies validator issue codes to requirement statuses. Unchecked items stay "pending" — never claimed met. */
export function applyIssues(r: Requirement[], codes: string[], checked: string[]): Requirement[] {
  const map: Record<string, string[]> = { count: ["missing", "extra", "duplicate", "order"], json: ["json_missing", "json_invalid"], words: ["word_count"], "no-commentary": ["commentary"], durations: ["duration_missing", "duration_unsupported"], total: ["duration_total", "duration_conflict_hidden"], table: ["table_columns", "table_duplicate", "table_total"] };
  return r.map((x) => {
    if (x.status === "impossible" || x.status === "conflicting") return x;
    const base = x.id.startsWith("script:") ? ["script"] : x.id.startsWith("name:") ? ["required_name"] : map[x.id] ?? [];
    if (base.some((c) => codes.includes(c))) return { ...x, status: "missing" };
    return checked.includes(x.id) || checked.includes(x.id.split(":")[0]) ? { ...x, status: "met" } : x;
  });
}

export function requirementsPrompt(r: Requirement[]): string {
  if (!r.length) return "";
  const lines = r.map((x) => `- [${x.mandatory ? "MUST" : "prefer"}] ${x.text}${x.status === "conflicting" ? " (conflicts with a stricter rule — follow the explicit numeric rule)" : x.status === "impossible" ? " (impossible as written — say so briefly)" : ""}`);
  return `\n\nRequirement checklist (do not drop any item in later parts or corrections):\n${lines.join("\n")}`;
}
