// Instruction parser + deterministic constraint checks (words, scripts, commentary, sections).
// Pure and browser-safe. Only extracts what the user explicitly wrote; never invents requirements.

export type Script = "latin" | "devanagari" | "bengali" | "arabic" | "cyrillic" | "cjk";
export type WordRange = { min: number | null; max: number | null; per: "item" | "total" };
export type ScriptRule = { part: "dialogue" | "description" | "all"; script: Script; language: string; /** "where appropriate": parts without dialogue are fine. */ optional?: boolean };
export type Instructions = {
  words: WordRange | null;
  maxChars: number | null;
  scripts: ScriptRule[];
  noCommentary: boolean;
  /** User forbade headings/titles ("no headings", "plain text"); checked deterministically. */
  noHeadings?: boolean;
  /** Continuity/consistency was asked for — subjective, checked by the reviewer, never claimed as verified. */
  consistency: boolean;
  /** Names that must appear in every item ("keep the robot named Bolt in every prompt"). */
  requiredNames?: string[];
};
import { ranges } from "./validators";

export type SectionIssue = { code: string; message: string; items?: number[] };

const LANG_SCRIPT: Record<string, Script> = {
  english: "latin", spanish: "latin", french: "latin", german: "latin", hinglish: "latin", romanized: "latin",
  hindi: "devanagari", marathi: "devanagari", nepali: "devanagari", sanskrit: "devanagari", devanagari: "devanagari",
  bengali: "bengali", bangla: "bengali", arabic: "arabic", urdu: "arabic", russian: "cyrillic",
  chinese: "cjk", japanese: "cjk",
};
const SCRIPT_RE: Record<Script, RegExp> = {
  latin: /\p{Script=Latin}/gu, devanagari: /\p{Script=Devanagari}/gu, bengali: /\p{Script=Bengali}/gu,
  arabic: /\p{Script=Arabic}/gu, cyrillic: /\p{Script=Cyrillic}/gu, cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
};

export function parseInstructions(text: string): Instructions {
  const t = text.slice(0, 20000);
  let words: WordRange | null = null;
  const per = (s: string) => (/\b(per|each|every)\b/i.test(s) ? "item" : "total") as WordRange["per"];
  const range = /(?:between\s+)?(\d{1,4})\s*(?:-|–|—|to|and)\s*(\d{1,4})\s*words?\b([^.\n]{0,30})/i.exec(t);
  if (range) words = { min: Number(range[1]), max: Number(range[2]), per: per(range[3] + t.slice(Math.max(0, range.index - 30), range.index)) };
  else {
    const max = /\b(?:under|at most|no more than|maximum(?: of)?|max|up to|within)\s*(\d{1,5})\s*words?\b([^.\n]{0,30})/i.exec(t);
    const min = /\b(?:at least|minimum(?: of)?|no fewer than|more than)\s*(\d{1,5})\s*words?\b([^.\n]{0,30})/i.exec(t);
    if (max || min) words = { min: min ? Number(min[1]) : null, max: max ? Number(max[1]) : null, per: per((max?.[2] ?? "") + (min?.[2] ?? "")) };
  }
  if (words && words.min != null && words.max != null && words.min > words.max) [words.min, words.max] = [words.max, words.min];

  const chars = /\b(?:under|at most|no more than|max(?:imum)?|within)\s*(\d{1,6})\s*char(?:acter)?s\b/i.exec(t);

  const scripts: ScriptRule[] = [];
  const langs = Object.keys(LANG_SCRIPT).join("|");
  const partOf = (s: string): ScriptRule["part"] =>
    /dialog(?:ue)?s?|speech|conversation|lines spoken/i.test(s) ? "dialogue" : /descriptions?|narration|narrative|prose|actions?/i.test(s) ? "description" : "all";
  const reA = new RegExp(`\\b(${langs})\\b(?:\\s*\\((?:in\\s+)?(\\w+)\\))?\\s+(?:[a-z]+\\s+)?(dialog(?:ue)?s?|speech|conversations?|descriptions?|narration|prose)(?:\\s+(?:in|using)\\s+(\\w+)(?:\\s+script)?)?`, "gi");
  const reB = new RegExp(`\\b(dialog(?:ue)?s?|speech|descriptions?|narration|prose)\\s+(?:must be |should be |are |is |written )?in\\s+(${langs})\\b(?:\\s*(?:\\(|in |using )\\s*(\\w+))?`, "gi");
  const add = (lang: string, part: ScriptRule["part"], scriptWord?: string) => {
    const script = (scriptWord && LANG_SCRIPT[scriptWord.toLowerCase()]) || LANG_SCRIPT[lang.toLowerCase()];
    if (script && !scripts.some((s) => s.part === part)) scripts.push({ part, script, language: lang.toLowerCase(), ...(part === "dialogue" && /\b(?:where|when|if)\s+(?:appropriate|needed|relevant|necessary|applicable)\b/i.test(t) ? { optional: true } : {}) });
  };
  for (const m of t.matchAll(reA)) add(m[1], partOf(m[3]), m[4] ?? m[2]);
  for (const m of t.matchAll(reB)) add(m[2], partOf(m[1]), m[3]);

  const noCommentary = /\b(no|without)\s+(?:any\s+)?(?:extra|additional|other)?\s*(commentary|comments|explanations?|preamble|intro(?:duction)?|notes)\b|\b(only|just)\s+(?:return|output|give)?\s*(?:the\s+)?(story|output|answer|code|json|list|scenes?)\s*(?:only|,|\.|$)|\b(?:return|output)\s+only\b/i.test(t);
  const consistency = /\b(consistent|consistency|continuity|continuous|coherent)\b/i.test(t);
  const noHeadings = /\b(?:no|without)\s+(?:any\s+)?(?:headings?|headers?|titles?|section\s+titles?)\b|\bplain[\s-]text\b/i.test(t);
  const requiredNames = parseRequiredNames(t);
  return { words, maxChars: chars ? Number(chars[1]) : null, scripts, noCommentary, consistency, noHeadings, ...(requiredNames.length ? { requiredNames } : {}) };
}

const EVERY = /\b(?:in|into|to)\s+(?:every|each|all(?:\s+the)?|all\s+\d+)\s+(?:single\s+)?(?:of\s+the\s+)?[a-z]+/i;
/** "named Bolt … in every prompt", "mention Bolt in each scene", "use the name Bolt in all prompts". */
export function parseRequiredNames(t: string): string[] {
  const names = new Set<string>();
  for (const sent of t.split(/(?<=[.!?;\n])\s+|,\s+(?=(?:and\s+)?(?:keep|make|use|include|mention))/)) {
    if (!EVERY.test(sent)) continue;
    for (const m of sent.matchAll(/\b(?:named|called|name)\s+["“']?([A-Z][\p{L}\d-]{1,30})/gu)) names.add(m[1]);
    const direct = /\b(?:keep|include|mention|use)\s+["“']?([A-Z][\p{L}\d-]{1,30})["”']?\s+(?:in|into)\s+(?:every|each|all)\b/u.exec(sent);
    if (direct && !/^(The|A|An|It|This|That|Every|Each|All)$/.test(direct[1])) names.add(direct[1]);
  }
  return [...names].slice(0, 5);
}

/** Items of an answer: labelled sections when present, otherwise top-level numbered list entries ("1." / "1)"). */
export function splitItems(text: string, noun: string | null): { num: number; body: string }[] {
  const body = text.replace(/^\s*```[\w-]*\s*$/gm, "");
  if (noun) { const s = splitSections(body, noun).sections; if (s.length) return s.map((x) => ({ num: x.num, body: x.body })); }
  const out: { num: number; body: string }[] = [];
  for (const line of body.split("\n")) {
    const m = /^\s{0,3}(?:\*\*)?(\d{1,4})[.)](?:\*\*)?\s+(.*)$/.exec(line);
    if (m) out.push({ num: Number(m[1]), body: m[2] });
    else if (out.length && line.trim() && !/^#{1,6}\s|^>/.test(line)) out[out.length - 1].body += `\n${line}`;
  }
  return out;
}

/** Word rule: a word is a whitespace-separated token containing at least one letter or digit (any script).
 *  Markdown symbols, labels such as "Scene 3:" and stand-alone punctuation are not counted. */
export function countWords(text: string): number {
  return text.replace(/[*_#>`|]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export type Section = { num: number; label: string; body: string; start: number; end: number };

/** Splits an answer into labelled sections ("Scene 1", "## Scene 2:", "**Scene 3**"). */
export function splitSections(text: string, noun: string): { preamble: string; sections: Section[] } {
  const re = new RegExp(`^[ \\t]{0,3}(?:#{1,6}\\s*)?(?:[*_]{1,2})?${noun}s?\\s*#?(\\d{1,4})\\b[^\\n]*$`, "gim");
  const heads = [...text.matchAll(re)];
  const sections = heads.map((m, i) => {
    const start = m.index!, end = i + 1 < heads.length ? heads[i + 1].index! : text.length;
    const label = m[0];
    const inline = label.replace(new RegExp(`^[ \\t]*(?:#{1,6}\\s*)?(?:[*_]{1,2})?${noun}s?\\s*#?\\d{1,4}\\s*(?:[*_]{1,2})?\\s*[:.)\\-–—]?\\s*(?:[*_]{1,2})?`, "i"), "");
    return { num: Number(m[1]), label, body: (inline + text.slice(start + label.length, end)).trim(), start, end };
  });
  return { preamble: heads.length ? text.slice(0, heads[0].index!).trim() : text.trim(), sections };
}

/** Dialogue = quoted text, or text after a "Dialogue:" / "Name:" speaker label. Everything else is description. */
export function splitDialogue(body: string): { dialogue: string; description: string } {
  const dialogue: string[] = [];
  // A quoted title in a heading line ("### Scene 1: \"Mission Briefing\"", "Title: \"…\"") is not dialogue.
  const titled = body.replace(/^\s*(?:#{1,6}\s.*|(?:\*\*)?(?:title|[\p{L}]+\s+\d{1,4})(?:\*\*)?\s*[:.—–-].*)$/gimu, (l) => l.replace(/[“"«][^”"»\n]*[”"»]/g, " ")).replace(/^\s*[:.—–-]?\s*(?:\*\*)?[“"«][^”"»\n]*[”"»]/, " ");
  // With an explicit dialogue field, quotes elsewhere (signs, on-screen text in the visual prompt) are description.
  const field = /^[ \t]*(?:[-*][ \t]*)?(?:\*\*)?(?:[\p{L}]+[ \t]+)?dialog(?:ue)?s?(?:\*\*)?[ \t]*(?:\([^)\n]*\))?[ \t]*(?:\*\*)?[ \t]*:/imu.exec(titled);
  const onlyIn = (seg: string) => seg.replace(/[“"«]([^”"»\n]+)[”"»]/g, (_, q) => { dialogue.push(q); return " "; });
  let rest: string;
  if (field) {
    const after = titled.slice(field.index);
    const stop = /\n[ \t]*(?:[-*][ \t]*)?(?:\*\*)?(?:continuity|camera|lighting|environment|visual|duration|actions?|clothing|title|notes?|transition|location|sound|music|scene)\b[^:\n]{0,40}:/i.exec(after);
    const seg = stop ? after.slice(0, stop.index) : after;
    rest = titled.slice(0, field.index) + onlyIn(seg) + (stop ? after.slice(stop.index) : "");
  } else rest = onlyIn(titled);
  // When quoted lines exist they ARE the dialogue: "Camera:", "Bolt:" etc. are then field/speaker labels, and
  // a parenthesised translation after the quote is not dialogue either.
  const quoted = dialogue.length > 0;
  // An explicit "Dialogue:" field means the other "Word:" lines are fields, not speakers.
  const fielded = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:[\p{L}]+\s+)?dialog(?:ue)?s?(?:\*\*)?\s*(?:\([^)\n]*\))?\s*(?:\*\*)?\s*:/imu.test(titled);
  rest = rest.replace(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:(?:[\p{L}]+\s+)?dialog(?:ue)?|speech|[\p{Lu}][\p{L}]{1,20})(?:\*\*)?\s*(?:\([^)]*\))?\s*:\s*(.+)$/gimu, (all, line: string) => {
    if (quoted) return all;
    if (fielded && !/^\s*(?:[-*]\s*)?(?:\*\*)?(?:[\p{L}]+\s+)?(?:dialog(?:ue)?|speech)\b/iu.test(all)) return all;
    // "Dialogue: None" / "Dialogue: —" means the part has no dialogue.
    if (/^\s*(?:[-*]\s*)?(?:\*\*)?(?:[\p{L}]+\s+)?(?:dialog(?:ue)?|speech)\b/iu.test(all) && /^\s*(?:none|n\/a|no dialogue|silence|silent|—|-)\s*\.?\s*(?:\([^)]*\))?\s*\.?\s*$/i.test(line)) return " ";
    // Unquoted dialogue line: drop parenthesised translations and a trailing "— spoken by X" attribution.
    line = line.replace(/\([^)]*\)/g, " ").replace(/\s[—–-]\s*(?:spoken|said|says|whispered|by)\b.*$/i, " ");
    if (/^(?:description|narration|setting|action|duration|scene|note)\b/i.test(all.trim())) return all;
    dialogue.push(line); return " ";
  });
  rest = rest.replace(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:description|narration|setting|action)(?:\*\*)?\s*:\s*/gim, "");
  return { dialogue: dialogue.join(" "), description: rest };
}

function scriptShare(text: string, script: Script): { share: number; letters: number } {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (!letters) return { share: 1, letters: 0 };
  return { share: (text.match(SCRIPT_RE[script]) ?? []).length / letters, letters };
}

/** Common French/Italian/Spanish/Portuguese/German words seen mixed into model-written Hindi dialogue (e.g. "nessuna", "aucune").
 *  English is excluded on purpose: names and technical terms are legitimate code-switching. */
const FOREIGN_WORDS = new Set("aucun aucune nessun nessuna nessuno rien pas avec pour mais très merci bonjour oui nous vous ils elles est sont voilà toujours jamais beaucoup encore ancora sempre grazie ciao perché molto sono siamo questo questa quello niente nulla adesso subito andiamo vamos gracias nada ahora siempre todo pero donde aquí también obrigado então agora nicht danke bitte jetzt immer nichts schnell".split(" "));

const COMMENTARY = /^(?:sure|certainly|of course|here(?:'s| is| are)|i hope|let me know|hope you|feel free|note:|this story|in this story|enjoy)\b/i;

/** Per-section checks. Each issue lists the affected item numbers so correction can target only those sections. */
export function checkInstructions(text: string, ins: Instructions, noun: string | null): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const body = text.replace(/```[\s\S]*?```/g, "");
  const { preamble, sections } = noun ? splitSections(body, noun) : { preamble: body, sections: [] as Section[] };
  const units = sections.length ? sections.map((s) => ({ num: s.num, body: s.body })) : [{ num: 0, body: body.trim() }];

  if (ins.words) {
    const { min, max } = ins.words;
    const out = (n: number) => (min != null && n < min) || (max != null && n > max);
    const rule = min != null && max != null ? `${min}–${max}` : min != null ? `at least ${min}` : `at most ${max}`;
    if (ins.words.per === "item" && sections.length) {
      const bad = units.map((u) => ({ num: u.num, n: countWords(u.body) })).filter((u) => out(u.n));
      if (bad.length) issues.push({ code: "word_count", items: bad.map((b) => b.num), message: `Each ${noun} must have ${rule} words; ${bad.slice(0, 40).map((b) => `${noun} ${b.num} has ${b.n}`).join(", ")}${bad.length > 40 ? ` and ${bad.length - 40} more (${ranges(bad.slice(40).map((b) => b.num))})` : ""}.` });
    } else if (ins.words.per === "item" && noun && /^paragraphs?$/i.test(noun)) {
      // Unlabelled paragraphs: each blank-line block is one paragraph.
      const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^#{1,6}\s/.test(p));
      const bad = paras.map((p, i) => ({ num: i + 1, n: countWords(p) })).filter((u) => out(u.n));
      if (bad.length) issues.push({ code: "word_count", message: `Each paragraph must have ${rule} words; ${bad.map((b) => `paragraph ${b.num} has ${b.n}`).join(", ")}.` });
    } else {
      const n = countWords(body);
      if (out(n)) issues.push({ code: "word_count", message: `The answer must have ${rule} words; it has ${n}.` });
    }
  }
  if (ins.maxChars && body.trim().length > ins.maxChars) issues.push({ code: "char_count", message: `The answer must be at most ${ins.maxChars} characters; it has ${body.trim().length}.` });

  for (const rule of ins.scripts) {
    const bad: number[] = [];
    const noDialogue: number[] = [];
    const foreign: { num: number; words: string[] }[] = [];
    for (const u of units) {
      const parts = splitDialogue(u.body);
      const part = rule.part === "dialogue" ? parts.dialogue : rule.part === "description" ? parts.description : u.body;
      const { share, letters } = scriptShare(part, rule.script);
      if (!letters) { if (rule.part === "dialogue") noDialogue.push(u.num); continue; }
      if (share < 0.9) { bad.push(u.num); continue; }
      // A few foreign words can hide under the 90% share: name each one (names and English tech terms are allowed).
      if (rule.part === "dialogue" && rule.script !== "latin") {
        const hits = [...new Set((part.match(/\p{L}{2,}/gu) ?? []).filter((w) => FOREIGN_WORDS.has(w.toLowerCase())))];
        if (hits.length) foreign.push({ num: u.num, words: hits });
      }
    }
    const where = rule.part === "all" ? "text" : rule.part;
    if (bad.length) issues.push({ code: "script", items: sections.length ? bad : undefined, message: `The ${where} must be ${rule.language} written in ${rule.script} script; it isn't in ${sections.length ? `${noun} ${ranges(bad)}` : "the answer"}.` });
    if (foreign.length) issues.push({ code: "foreign_words", items: sections.length ? foreign.map((f) => f.num) : undefined, message: `The ${rule.language} dialogue mixes in words from another language: ${foreign.map((f) => `${sections.length ? `${noun} ${f.num}` : "answer"}: "${f.words.join('", "')}"`).join("; ")}. Replace them with ${rule.language} words.` });
    // Checked per section so a later batch that drops the dialogue format is caught too.
    if (rule.part === "dialogue" && !rule.optional && noDialogue.length) issues.push({ code: "dialogue_missing", items: sections.length ? noDialogue : undefined, message: `No ${rule.language} dialogue (in quotes) was found in ${sections.length ? `${noun} ${ranges(noDialogue)}` : "the answer"}.` });
  }

  if (ins.requiredNames?.length) {
    const items = splitItems(text, noun);
    for (const name of ins.requiredNames) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const miss = items.filter((u) => !re.test(u.body)).map((u) => u.num);
      if (miss.length) issues.push({ code: "required_name", items: sections.length ? miss : undefined, message: `"${name}" must appear by name in every ${noun ?? "item"}; it is missing from ${noun ?? "item"} ${ranges(miss)} (replace pronouns or generic references with "${name}").` });
    }
  }
  if (ins.noHeadings && /^#{1,6}\s/m.test(body)) issues.push({ code: "headings", message: "Remove every heading and title line — the user asked for no headings." });
  if (ins.noCommentary) {
    const pre = preamble.split("\n").map((l) => l.trim()).filter(Boolean);
    const extraIntro = sections.length ? pre.filter((l) => !/^#{1,6}\s|^\*\*[^*]+\*\*$/.test(l)) : pre.filter((l) => COMMENTARY.test(l));
    const last = sections[sections.length - 1];
    const tail = last ? last.body.split("\n").map((l) => l.trim()).filter((l) => COMMENTARY.test(l) || /^---+$/.test(l)) : [];
    if (extraIntro.length || tail.length) issues.push({ code: "commentary", items: !extraIntro.length && last ? [last.num] : undefined, message: "Remove the commentary — return only the requested output, with no intro or closing remarks." });
  }
  return issues;
}

/** Replaces same-numbered sections in `text` with those from `patch` and inserts missing ones in numeric order.
 *  Returns null when the patch contained none of the requested sections. */
export function spliceSections(text: string, patch: string, noun: string, only: number[]): string | null {
  const { sections: orig } = splitSections(text, noun);
  const repl = new Map(splitSections(patch, noun).sections.filter((s) => only.includes(s.num)).map((s) => [s.num, patch.slice(s.start, s.end).trim()]));
  if (!repl.size) return null;
  if (!orig.length) return [...repl.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join("\n\n");
  const head = text.slice(0, orig[0].start).trimEnd();
  const parts = new Map<number, string>();
  for (const s of orig) if (!parts.has(s.num)) parts.set(s.num, text.slice(s.start, s.end).trim());
  for (const [n, t] of repl) parts.set(n, t);
  // Keep original order for existing sections; place inserted ones before the first higher number.
  const order = orig.map((s) => s.num).filter((n, i, a) => a.indexOf(n) === i);
  for (const n of [...repl.keys()].sort((a, b) => a - b)) if (!order.includes(n)) { const at = order.findIndex((m) => m > n); at < 0 ? order.push(n) : order.splice(at, 0, n); }
  return (head ? head + "\n\n" : "") + order.map((n) => parts.get(n)!).join("\n\n");
}

/** Deterministic structural repair: drops numbers outside 1..count and later duplicates, and restores label order.
 *  Content is never rewritten; returns the original text when nothing changed. */
export function normalizeSections(text: string, noun: string, count: number): string {
  const { sections } = splitSections(text, noun);
  if (!sections.length) return text;
  const seen = new Set<number>(), keep: Section[] = [];
  for (const s of sections) if (s.num >= 1 && s.num <= count && !seen.has(s.num)) { seen.add(s.num); keep.push(s); }
  const sorted = [...keep].sort((a, b) => a.num - b.num);
  if (keep.length === sections.length && sorted.every((s, i) => s === keep[i])) return text;
  const head = text.slice(0, sections[0].start).trimEnd();
  return (head ? head + "\n\n" : "") + sorted.map((s) => text.slice(s.start, s.end).trim()).join("\n\n");
}

export function instructionAddendum(ins: Instructions, noun: string | null): string[] {
  const lines: string[] = [];
  if (ins.words) {
    const r = ins.words.min != null && ins.words.max != null ? `${ins.words.min}–${ins.words.max}` : ins.words.min != null ? `at least ${ins.words.min}` : `at most ${ins.words.max}`;
    lines.push(`${ins.words.per === "item" && noun ? `Each ${noun}` : "The whole answer"} must contain ${r} words (labels like "${noun ?? "Item"} 1:" are not counted).`);
  }
  if (ins.maxChars) lines.push(`Keep the answer within ${ins.maxChars} characters.`);
  for (const s of ins.scripts) lines.push(`${s.part === "all" ? "All text" : s.part === "dialogue" ? "All dialogue (in double quotes)" : "All descriptions"} must be ${s.language} in ${s.script} script${s.part === "dialogue" ? "; do not mix in other scripts" : ""}.`);
  if (ins.noHeadings) lines.push("Do not use any headings or title lines (no lines starting with #).");
  if (ins.noCommentary) lines.push("Return only the requested output: no intro, no closing remarks, no notes.");
  for (const n of ins.requiredNames ?? []) lines.push(`Write the name "${n}" explicitly in every ${noun ?? "item"} — never only "he", "she", "it" or "the robot".`);
  if (ins.consistency) lines.push("Keep characters' names, appearance, clothing and the timeline consistent across every part.");
  return lines;
}
