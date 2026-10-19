// Deep Thinking Mode — deterministic request analysis. Pure and browser-safe so it is unit-tested.
// Extracts the checkable requirements (counts, length, format, duration constraints) from the user's text.

import { parseInstructions, type Instructions } from "./instructions";

export type LengthPref = "short" | "detailed" | "auto";

export type RequestAnalysis = {
  /** Number of separate outputs explicitly requested, e.g. "6 scenes" → { count: 6, noun: "scene" }. */
  items: { count: number; noun: string } | null;
  length: LengthPref;
  wantsJson: boolean;
  /** Allowed clip lengths in seconds, e.g. [4, 6, 8, 10]. */
  allowedDurations: number[] | null;
  /** Total audio / video length in seconds. */
  totalDuration: number | null;
  /** True when the request has requirements worth a verify-and-correct pass. */
  complex: boolean;
  /** Explicit word/script/commentary/consistency rules. Optional so older callers and fixtures stay valid. */
  instructions?: Instructions;
  /** Figures the user supplied for a calculation ("6%", "$200,000"); the answer must keep using them. */
  inputs?: string[];
};

/** Percentages and money amounts stated in a calculation request. */
export function parseInputs(t: string): string[] {
  if (!/\b(calculat|comput|solve|work out|how much|monthly payment|interest|invest|loan|mortgage)/i.test(t)) return [];
  const out = new Set<string>();
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) out.add(`${m[1]}%`);
  for (const m of t.matchAll(/(?:\$|USD\s?|€|£|₹)\s?(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?/g)) out.add(m[1].replace(/,/g, ""));
  return [...out].slice(0, 8);
}

/** Resource cap only (not a validation assumption): requests above this are refused honestly, never shrunk. */
export const MAX_ITEMS = 1000;

const WORD_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  one: 1, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const NOUNS = "scenes?|prompts?|items?|steps?|ideas?|examples?|points?|sections?|questions?|tips?|reasons?|files?|options?|names?|titles?|slides?|shots?|chapters?|panels?|episodes?|beats?|paragraphs?|bullets?|recommendations?|findings?";
const COUNT_RE = new RegExp(`\\b(\\d{1,4}|${Object.keys(WORD_NUM).join("|")})(?:\\s+|-)(?:[a-z-]+\\s+){0,2}?(${NOUNS})\\b`, "i");

export function singular(noun: string) {
  return noun.toLowerCase().replace(/s$/, "");
}

function toNum(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : WORD_NUM[v.toLowerCase()] ?? NaN;
}

function parseClock(v: string, unit?: string): number {
  if (v.includes(":")) { const [m, s] = v.split(":").map(Number); return m * 60 + s; }
  const n = Number(v);
  return unit && /^min/i.test(unit) ? n * 60 : n;
}

export function analyzeRequest(text: string): RequestAnalysis {
  const t = text;
  const m = COUNT_RE.exec(t);
  const count = m ? toNum(m[1]) : NaN;
  const items = Number.isFinite(count) && count >= 1 && count <= MAX_ITEMS ? { count, noun: singular(m![2]) } : null;

  const short = /\b(short|brief|briefly|concise|one[- ]line|one sentence|in a sentence|tl;?dr|just the answer|yes or no)\b/i.test(t);
  const detailed = /\b(detailed|in[- ]depth|comprehensive|thorough|thoroughly|elaborate|step[- ]by[- ]step|full explanation)\b/i.test(t);
  const length: LengthPref = short && !detailed ? "short" : detailed ? "detailed" : "auto";

  const wantsJson = /\bjson\b/i.test(t);

  // "4, 6, 8, or 10 second clips" / "4/6/8/10s"
  let allowedDurations: number[] | null = null;
  const list = /\b(\d{1,2}(?:\s*(?:,\s*(?:or|and)?|\/|or|and)\s*\d{1,2}){1,7})\s*[- ]?(?:s|sec|secs|seconds?)\b/i.exec(t);
  if (list) {
    const vals = [...new Set(list[1].split(/\s*(?:,\s*(?:or|and)?|\/|or|and)\s*/i).map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
    if (vals.length >= 2) allowedDurations = vals;
  }

  let totalDuration: number | null = null;
  const totRes = [/\b(?:audio|narration|voice[- ]?over|voiceover|video|total)\b[^.\n\d]{0,40}?(\d{1,2}:\d{2}|\d+(?:\.\d+)?)\s*(min(?:ute)?s?|s|sec|secs|seconds?)?\b/gi, /\b(\d{1,2}:\d{2}|\d+(?:\.\d+)?)\s*(min(?:ute)?s?|s|sec|secs|seconds?)\b[^.\n]{0,20}\b(?:audio|narration|voice[- ]?over|voiceover)\b/gi];
  const tot = totRes.flatMap((re) => [...t.matchAll(re)]).find((m) => m[2] || m[1].includes(":"));
  if (tot) {
    const v = parseClock(tot[1], tot[2]);
    if (v > 0 && v < 36000) totalDuration = v;
  }

  const instructions = parseInstructions(t);
  const hasRules = !!instructions.words || !!instructions.maxChars || instructions.scripts.length > 0 || instructions.noCommentary || !!instructions.noHeadings || instructions.consistency || !!instructions.requiredNames?.length;
  const complex = !!items || wantsJson || !!allowedDurations || length === "detailed" || t.length > 600 || hasRules;
  const inputs = parseInputs(t);
  return { items, length, wantsJson, allowedDurations, totalDuration, complex: complex || inputs.length > 0, ...(hasRules ? { instructions } : {}), ...(inputs.length ? { inputs } : {}) };
}
