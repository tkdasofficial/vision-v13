// FROZEN copy of src/lib/ai/requirement-spec.ts taken before the multilingual work (2026-10-16). Baseline only — never edit.
// Requirement Understanding Engine. Pure, browser-safe, deterministic (no model calls), tested by the
// benchmark in src/test/requirement-benchmark.test.ts. Turns a user request (+ chat history) into a structured,
// extensible spec: only fields the request actually contains are present, and every entry records whether it
// was stated (explicit) or inferred, mandatory or optional, plus the exact text it came from.
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { parseRequiredNames } from "@/lib/ai/deep/instructions";
import { resolveReference, type ConvMsg } from "@/lib/ai/references";

export type ReqSource = "explicit" | "inferred";
export type Req = { kind: string; value: string; source: ReqSource; mandatory: boolean; evidence: string };
export type RequirementSpec = { normalized: string; reqs: Req[]; gaps: string[] };

// ---------- normalization: typos + Hinglish (applied to a copy used only for matching) ----------
const TYPOS: Record<string, string> = { writ: "write", giv: "give", plz: "please", pls: "please", abt: "about", secnes: "scenes", scnes: "scenes", flim: "film", wrods: "words", wrds: "words", bulet: "bullet", bulets: "bullets", tabel: "table", tabl: "table", promts: "prompts", pargraph: "paragraph", paragrph: "paragraph", qustions: "questions", summery: "summary", emial: "email" };
const LANGS = "hindi|english|german|french|spanish|italian|bengali|bangla|marathi|tamil|telugu|urdu|arabic|russian|chinese|japanese|portuguese|hinglish";
export function normalize(text: string): string {
  let t = " " + text.slice(0, 20000).replace(/[‘’]/g, "'").replace(/[“”]/g, '"') + " ";
  t = t.replace(/\b[A-Za-z]+\b/g, (w) => TYPOS[w.toLowerCase()] ?? w);
  t = t.replace(/\bbina\s+([\p{L}]+(?:\s+[\p{L}]+)?)\s+ke\b/giu, "without $1,");
  t = t.replace(/\b([\p{L}]+)\s+ke\s+saath\b/giu, "include $1");
  t = t.replace(new RegExp(`\\b(${LANGS})\\s+(?:mein|me|main)\\b`, "gi"), "in $1");
  t = t.replace(/\blikh(?:o|iye|\s+do|\s+dijiye)\b/gi, "write").replace(/\bsawal\b/gi, "questions");
  t = t.replace(/\bek\b/gi, "one").replace(/\bteen\b/gi, "three").replace(/\bpaanch\b/gi, "five").replace(/\bdas\b/gi, "ten");
  return t.trim();
}

// ---------- extractors ----------
const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const NOUNS = "scenes?|prompts?|items?|steps?|ideas?|examples?|points?|sections?|questions?|tips?|reasons?|options?|names?|titles?|slides?|shots?|chapters?|paragraphs?|bullets?|bullet points?|recommendations?|findings?|descriptions?|captions?|shayari|lines?|countries|country|planets?|poems?|haikus?|stories|story|jokes?|quotes?|tweets?|posts?|headlines?|taglines?|sentences?|facts?|slogans?";
const COUNT_RE = new RegExp(`\\b(\\d{1,4}|${Object.keys(WORDNUM).join("|")})(?:\\s+|-)(?:[a-z-]+\\s+){0,2}?(${NOUNS})\\b`, "gi");
const sing = (n: string) => { const w = n.toLowerCase().replace(/\s+points?$/, ""); return w === "shayari" ? w : w.endsWith("ies") ? w.slice(0, -3) + "y" : w.replace(/s$/, ""); };
const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : WORDNUM[v.toLowerCase()] ?? NaN);
const clauseOf = (t: string, i: number) => t.slice(Math.max(t.lastIndexOf(".", i - 1), t.lastIndexOf(";", i - 1), t.lastIndexOf("\n", i - 1)) + 1, i);
const OPTIONAL = /\b(if possible|would be nice|preferably|ideally|optional(?:ly)?|if you can|nice to have)\b/i;
const segOf = (t: string, i: number) => { const s = Math.max(t.lastIndexOf(";", i), t.lastIndexOf(".", i), t.lastIndexOf(",", i)) + 1; const e = t.slice(i).search(/[.;\n]/); return t.slice(s, e < 0 ? t.length : i + e); };
const clean = (s: string) => s.trim().toLowerCase().replace(/^(?:with|having)\s+/, "").replace(/^(?:a|an|the|any|some)\s+/, "").replace(/[.,;:!]+$/, "").trim();

export function buildSpec(text: string, history: ConvMsg[] = []): RequirementSpec {
  const t = normalize(text), low = t.toLowerCase(), reqs: Req[] = [];
  const add = (kind: string, value: string, evidence: string, o: Partial<Req> = {}) => { if (!reqs.some((r) => r.kind === kind && r.value === value)) reqs.push({ kind, value, source: "explicit", mandatory: true, evidence: evidence.trim().slice(0, 160), ...o }); };
  const a = analyzeRequest(t);

  // Quantity: first explicit count, then the latest correction ("actually make it 7") wins.
  const counts = [...t.matchAll(COUNT_RE)].filter((m) => Number.isFinite(num(m[1])) && num(m[1]) >= 1 && !(num(m[1]) === 1 && /^(?:sentence|line)$/.test(sing(m[2])) && /\bin\s*$/i.test(t.slice(Math.max(0, (m.index ?? 0) - 4), m.index))));
  let count = counts[0] ? { n: num(counts[0][1]), noun: sing(counts[0][2]), ev: counts[0][0] } : null;
  const corr = [...t.matchAll(/\b(?:actually|instead|no,?|wait,?|sorry,?)\s+(?:make\s+it|give\s+me|do|use)?\s*(\d{1,4})\b|\bmake\s+it\s+(\d{1,4})\s+instead\b/gi)].pop();
  if (corr && count) count = { ...count, n: Number(corr[1] ?? corr[2]), ev: corr[0] };
  const more = /\b(\d{1,4})\s+more\b/i.exec(t);
  if (!count && more) count = { n: Number(more[1]), noun: "item", ev: more[0] };
  if (count) add("count", `${count.n}:${count.noun}`, count.ev);

  // Length limits (words / characters) with per-item vs total scope, and impossible ranges.
  const wr = /(?:between\s+)?(\d{1,5})\s*(?:-|–|to|and)\s*(\d{1,5})\s*words?\b/i.exec(t);
  const wmax = /\b(?:under|at most|no more than|max(?:imum)?(?: of)?|up to|within|less than|fewer than)\s*(\d{1,5})\s*words?\b/i.exec(t);
  const wmin = /(?<!\bno\s)\b(?:at least|minimum(?: of)?|no fewer than|more than|over)\s*(\d{1,5})\s*words?\b/i.exec(t);
  const scope = (m: RegExpExecArray) => (/\b(each|per|every)\b/i.test(clauseOf(t, m.index) + t.slice(m.index + m[0].length, m.index + m[0].length + 12)) ? "item" : "total");
  let wordsMax: number | null = null;
  if (wr && !/\bseconds?\b/i.test(wr[0])) add("words", `${wr[1]}-${wr[2]}:${scope(wr)}`, wr[0]);
  else if (wmin && wmax && Number(wmin[1]) > Number(wmax[1])) add("conflict", "words", `${wmin[0]} … ${wmax[0]}`);
  else if (wmin || wmax) { const m = (wmax ?? wmin)!; wordsMax = wmax ? Number(wmax[1]) : null; add("words", `${wmin?.[1] ?? ""}-${wmax?.[1] ?? ""}:${scope(m)}`, m[0]); }
  const ch = /\b(?:under|at most|no more than|max(?:imum)?|within|less than)\s*(\d{1,6})\s*char(?:acter)?s\b/i.exec(t);
  if (ch) add("chars", ch[1], ch[0]);

  // Length preference.
  const short = /\b(brief|briefly|short|shorter|concise|one[- ]sentence|in a sentence|one[- ]line|tl;?dr)\b/i.exec(t.replace(/\bshort\s+(film|video|clip|form)\b/gi, ""));
  const det = /\b(detailed|in[- ]depth|comprehensive|thorough(?:ly)?|step[- ]by[- ]step|elaborate)\b/i.exec(t);
  if (short) add("length", "short", short[0]);
  if (det) add("length", "detailed", det[0]);
  if (short && det && !/\bshort\b[^.]{0,40}\bdetailed\b|\bdetailed\b[^.]{0,40}\bshort\b/i.test(t) && !/\b(?:but|and|yet)\b/i.test(t)) reqs.splice(reqs.findIndex((r) => r.kind === "length" && r.value === "short"), 1);
  if (det && (short || (wordsMax != null && wordsMax < 80 && !reqs.some((r) => r.kind === "words" && r.value.endsWith(":item"))))) add("conflict", "length", det[0]);

  // Output format.
  const fmt = (name: string, re: RegExp) => { const m = re.exec(t); if (m) add("format", name, segOf(t, m.index), { mandatory: !OPTIONAL.test(segOf(t, m.index)) }); };
  fmt("json", /\bjson\b/i); fmt("yaml", /\bya?ml\b/i); fmt("csv", /\bcsv\b/i); fmt("table", /\b(table|tabular)\b/i);
  fmt("numbered", /\bnumbered\b/i); fmt("bullets", /\bbullets?(?:\s+points?)?\b/i);
  const code = /\b(python|sql|bash|shell|javascript|typescript|react|java|go|rust|html|css|php|ruby|c\+\+|c#|kotlin|swift)\s+(function|query|script|code|component|program|class|snippet|app)\b/i.exec(t);
  if (code) add("format", `code-${code[1].toLowerCase()}`, code[0]);
  const data = reqs.filter((r) => r.kind === "format" && ["json", "yaml", "csv"].includes(r.value)).length;
  const hasTable = reqs.some((r) => r.kind === "format" && r.value === "table" && r.mandatory);
  const fmtConflict = data > 1 || (data === 1 && hasTable);
  if (fmtConflict) add("conflict", "format", "multiple incompatible output formats");

  // Tone.
  const tones: [string, RegExp][] = [["formal", /\bformal\b/i], ["casual", /\b(casual|informal)\b/i], ["friendly", /\bfriendly\b/i], ["professional", /\bprofessional\b/i], ["humorous", /\b(humorous|funny)\b/i], ["persuasive", /\bpersuasive\b/i]];
  for (const [n, re] of tones) { const m = re.exec(t.replace(/\binformal\b/gi, "casual")); if (m) add("tone", n, m[0]); }
  if (reqs.some((r) => r.value === "formal") && reqs.some((r) => r.value === "casual")) add("conflict", "tone", "formal and casual");

  // Deliverable type.
  const dels: [string, RegExp][] = [["email", /\b(?:a|an|the|my|this|write|draft)\s+(?:\w+\s+)?e-?mail\b/i], ["haiku", /\bhaikus?\b/i], ["poem", /\bpoe(?:m|ms|try)\b/i], ["tweet", /\btweets?\b/i], ["story", /\bstor(?:y|ies)\b/i], ["letter", /\bletter\b/i], ["proposal", /\bproposal\b/i], ["blog", /\bblog\b/i], ["summary", /\bsummar(?:y|ise|ize)\b/i], ["essay", /\bessay\b/i], ["report", /\breport\b/i]];
  for (const [n, re] of dels) { const m = re.exec(t); if (m && !(n === "poem" && reqs.some((r) => r.value === "haiku"))) add("deliverable", n, m[0]); }

  // Output language (explicit) vs language of the request (inferred), and per-part scripts.
  const PART = "dialog(?:ue)?s?|descriptions?|narration|prose|speech";
  const partOf = (p: string) => (/dialog|speech/i.test(p) ? "dialogue" : "description");
  for (const m of t.matchAll(new RegExp(`\\b(${PART})\\s+(?:must be |should be |written )?in\\s+(${LANGS})\\b`, "gi"))) add("script", `${partOf(m[1])}:${m[2].toLowerCase()}`, m[0]);
  for (const m of t.matchAll(new RegExp(`\\b(${LANGS})\\s*(?:\\([^)]{1,20}\\)\\s*)?(${PART})\\b`, "gi"))) add("script", `${partOf(m[2])}:${m[1].toLowerCase()}`, m[0]);
  for (const m of t.matchAll(new RegExp(`\\bin\\s+(${LANGS})\\b(?!\\s*(?:\\([^)]*\\)\\s*)?(?:${PART}))`, "gi"))) {
    if (new RegExp(`(?:${PART})\\s+(?:must be |should be |written )?$`, "i").test(t.slice(Math.max(0, m.index - 30), m.index))) continue;
    add("lang", m[1].toLowerCase(), m[0]);
  }
  if (!reqs.some((r) => r.kind === "lang" || r.kind === "script")) {
    const hits = (re: RegExp) => (low.match(re) ?? []).length;
    const inferred = /\p{Script=Devanagari}/u.test(t) ? "hindi" : hits(/\b(escribe|para|una|unos|del|cómo|qué|por favor)\b/g) >= 2 ? "spanish" : hits(/\b(écris|pour|une|avec|s'il|vous|des)\b/g) >= 2 ? "french" : hits(/\b(schreibe|für|eine|und|bitte|mit)\b/g) >= 2 ? "german" : null;
    if (inferred) add("lang", inferred, "language the request is written in", { source: "inferred" });
  }

  // Commentary / headings.
  const noComm = /\b(?:no|without)\s+(?:any\s+)?(?:extra|additional|other)?\s*(?:commentary|comments|explanations?|preamble|intro(?:duction)?)\b|\b(?:return|output|give|reply with)\s+only\b|\b(?:json|csv|yaml|code)\s+only\b|\bonly\s+(?:return|output)\b/i.exec(t);
  if (noComm && !fmtConflict) add("no-commentary", "", noComm[0]);
  const noHead = /\b(?:no|without)\s+(?:any\s+)?(?:headings?|headers?|titles?|section\s+titles?)\b|\bplain[\s-]text\b/i.exec(t);
  if (noHead) add("no-headings", "", noHead[0]);

  // Required / prohibited elements, verbatim text, preserved parts, edit scope.
  for (const m of t.matchAll(/\b(?:don'?t|do not|never|must not)\s+(?:mention|include|use|add|say)\s+([^.,;\n]+)|\bavoid\s+([^.,;\n]+)|\bwithout\s+([^.,;\n]+)/gi)) {
    const v = clean(m[1] ?? m[2] ?? m[3]); if (v && v.split(" ").length <= 5 && !/^(?:headings?|headers?|titles?|section titles?)$/.test(v)) add("exclude", v, m[0]);
  }
  for (const m of t.matchAll(/\binclude\s+(?!this\b|the following\b|exactly\b)([^.,;\n]+)/gi)) for (const p of m[1].split(/\s+and\s+/)) { const v = clean(p); if (v) add("include", v, m[0]); }
  for (const m of t.matchAll(/\b(?:preferably|ideally)\s+([^.,;\n]+)|\bif possible,?\s+with\s+([^.,;\n]+)/gi)) { const v = clean(m[1] ?? m[2]); if (v) add("include", v, m[0], { mandatory: false }); }
  if (/\b(exactly|word for word|verbatim|as[- ]is|unchanged)\b/i.test(t)) for (const m of t.matchAll(/"([^"\n]{2,300})"/g)) add("verbatim", m[1].toLowerCase(), m[0]);
  for (const m of t.matchAll(/\bkeep\s+(?:the\s+)?([\w ]{2,30}?)\s+(?:unchanged|as[- ]is|the same|intact)\b|\b(?:don'?t|do not)\s+change\s+(?:any\s+of\s+)?(?:the\s+)?([\w ]{2,30}?)(?=[.,;\n]|$)/gi)) add("preserve", clean(m[1] ?? m[2]), m[0]);
  for (const m of t.matchAll(/\b(?:rewrite|edit|change|fix|update|translate)\s+only\s+(?:the\s+)?([\w ]{2,30}?)(?=[.,;\n]|$)/gi)) add("only", clean(m[1]), m[0]);

  // Ordering, names, continuity, durations, conditions.
  const ord = /\b(descending|ascending|alphabetical(?:ly)?|chronological(?:ly)?)\b/i.exec(t);
  if (ord) add("order", ord[1].toLowerCase().replace(/ly$/, "").replace(/ical$/, "ical"), ord[0]);
  for (const n of parseRequiredNames(t)) add("name", n.toLowerCase(), n);
  if (/\b(consistent|consistency|continuity|coherent)\b/i.test(t)) add("consistency", "", "continuity");
  if (a.allowedDurations) add("durations", a.allowedDurations.join("/"), "clip lengths");
  if (a.totalDuration) add("duration-total", String(a.totalDuration), "total length");
  const cond = /\bif\s+(?!possible\b|needed\b|necessary\b|appropriate\b|you can\b)[^,.;\n]{2,80},\s*[^.;\n]+/i.exec(t);
  if (cond) add("conditional", "", cond[0]);

  // Conversation references and ambiguity (only where it materially blocks the answer).
  const hasAnswer = history.some((m) => m.role === "assistant");
  const ref = resolveReference(t, history);
  if (ref.kind === "found") { const o = /\b(first|second|third|fourth|fifth)\b/i.exec(ref.label); add("ref", o ? o[1].toLowerCase() : "previous", ref.label); }
  else if (ref.kind === "ambiguous") add("ambiguous", "reference", ref.label);
  else if (ref.kind === "missing") add("ambiguous", "reference", ref.label);
  const sameAs = /\b(previous|same)\s+(format|style|structure|layout)\b|\bdo\s+the\s+same\b|\b(?:make|do|fix|improve|redo|change)\s+it\b(?!\s+(?:short|shorter|longer|brief|formal|casual|funny|simple|concise|detailed|\d|one|two|three|four|five|six|seven|eight|nine|ten)\b)/i.exec(t);
  if (sameAs && !reqs.some((r) => r.kind === "ref")) hasAnswer ? add("ref", "previous", sameAs[0]) : add("ambiguous", "reference", sameAs[0]);
  if (/^(?:please\s+)?(?:write|tell me|say)\s+(?:something|anything|stuff)\s+(?:about\s+)?(?:it|this|that)?\.?$/i.test(t)) add("ambiguous", "topic", t);
  if (/^(?:please\s+)?(?:translate|summari[sz]e|rewrite|proofread|shorten)\s+(?:this|that|it)\.?$/i.test(t) && !hasAnswer) add("ambiguous", "missing-input", t);

  return { normalized: t, reqs, gaps: coverageGaps(t, reqs) };
}

/** Deterministic coverage check: clauses that look like instructions but produced no requirement. */
export function coverageGaps(t: string, reqs: Req[]): string[] {
  const ev = reqs.map((r) => r.evidence.toLowerCase()).join(" | ");
  const gaps: string[] = [];
  for (const s of t.split(/(?<=[.!?;\n])\s+/)) {
    const neg = /\b(don'?t|do not|never|must not|avoid|no)\b\s+\w+/i.exec(s);
    if (neg && !ev.includes(neg[0].toLowerCase().split(/\s+/)[1] ?? "~") && !reqs.some((r) => s.toLowerCase().includes(r.evidence.toLowerCase().slice(0, 12)))) gaps.push(s.trim().slice(0, 200));
    const n = /\b\d{1,5}\s+(?:words?|characters?|items?|seconds?|minutes?|pages?)\b/i.exec(s);
    if (n && !reqs.some((r) => r.evidence.includes(n[0].split(/\s+/)[0]))) gaps.push(s.trim().slice(0, 200));
  }
  return [...new Set(gaps)].slice(0, 6);
}

/** Benchmark atoms: kind[:value] with "?" for optional and "~" for inferred. */
export function specAtoms(text: string, history: ConvMsg[] = []): string[] {
  return buildSpec(text, history).reqs.map((r) => `${r.kind}${r.value ? `:${r.value}` : ""}${r.source === "inferred" ? "~" : !r.mandatory ? "?" : ""}`);
}

/** System-prompt block. Explicit and inferred entries are labelled separately; uncaptured clauses are quoted verbatim. */
export function specPrompt(spec: RequirementSpec): string {
  const show = (r: Req) => `- [${r.mandatory ? "MUST" : "optional"}] ${r.kind}${r.value ? `: ${r.value}` : ""} (user wrote: "${r.evidence}")`;
  const explicit = spec.reqs.filter((r) => r.source === "explicit" && !["conflict", "ambiguous"].includes(r.kind));
  const inferred = spec.reqs.filter((r) => r.source === "inferred");
  const conflicts = spec.reqs.filter((r) => r.kind === "conflict"), amb = spec.reqs.filter((r) => r.kind === "ambiguous");
  if (!explicit.length && !inferred.length && !conflicts.length && !amb.length && !spec.gaps.length) return "";
  let out = "\n\nUnderstood requirements (from the user's own words; do not drop, invent or change any):";
  if (explicit.length) out += `\n${explicit.map(show).join("\n")}`;
  if (inferred.length) out += `\nInferred (not stated — a sensible default the user may override):\n${inferred.map(show).join("\n")}`;
  if (spec.gaps.length) out += `\nAlso follow these instructions exactly as written:\n${spec.gaps.map((g) => `- "${g}"`).join("\n")}`;
  if (conflicts.length) out += `\nConflicting instructions (${conflicts.map((c) => c.value).join(", ")}): follow the most specific/explicit numeric rule and state the conflict in one short line.`;
  if (amb.some((a) => a.value !== "reference" || !spec.reqs.some((r) => r.kind === "ref"))) out += `\nThe request is missing something essential (${amb.map((a) => a.value).join(", ")}). Ask exactly one short clarifying question instead of guessing.`;
  return out;
}
