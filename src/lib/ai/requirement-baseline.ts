// Baseline adapter: expresses what the PRE-upgrade code (analyzeRequest + buildRequirements + resolveReference)
// understood, in benchmark atoms. Kept unchanged so the benchmark can always compare against it.
import { analyzeRequest } from "./deep/analyze";
import { buildRequirements } from "./requirements";
import { resolveReference, type ConvMsg } from "./references";

const ORD = ["", "first", "second", "third", "fourth", "fifth"];
export function baselineAtoms(text: string, history: ConvMsg[] = []): string[] {
  const a = analyzeRequest(text), out = new Set<string>();
  if (a.items) out.add(`count:${a.items.count}:${a.items.noun}`);
  if (a.length !== "auto") out.add(`length:${a.length}`);
  if (a.wantsJson) out.add("format:json");
  if (a.allowedDurations) out.add(`durations:${a.allowedDurations.join("/")}`);
  if (a.totalDuration) out.add(`duration-total:${a.totalDuration}`);
  const ins = a.instructions;
  if (ins?.words) out.add(`words:${ins.words.min ?? ""}-${ins.words.max ?? ""}:${ins.words.per}`);
  if (ins?.maxChars) out.add(`chars:${ins.maxChars}`);
  for (const s of ins?.scripts ?? []) out.add(`script:${s.part}:${s.language}`);
  for (const n of ins?.requiredNames ?? []) out.add(`name:${n.toLowerCase()}`);
  if (ins?.noCommentary) out.add("no-commentary");
  if (ins?.noHeadings) out.add("no-headings");
  if (ins?.consistency) out.add("consistency");
  for (const r of buildRequirements(a, text)) {
    if (r.id === "table") out.add(r.mandatory ? "format:table" : "format:table?");
    if (r.status === "impossible") out.add("conflict:words");
    if (r.status === "conflicting") out.add("conflict:length");
  }
  const ref = resolveReference(text, history);
  if (ref.kind === "found") out.add(ref.role === "assistant" && ref.ordinal === history.filter((m) => m.role === "assistant").length && !/first|second|third/.test(ref.label) ? "ref:previous" : `ref:${ORD[ref.ordinal] ?? ref.ordinal}`);
  if (ref.kind === "ambiguous") out.add("ambiguous:reference");
  return [...out];
}
