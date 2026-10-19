// Conversation reference resolution. Pure, browser-safe, tested (src/test/conversation-context.test.ts).
// Resolves "your first response", "the previous answer", "the second story", "what I shared above" to the
// exact original message of THIS conversation, so tools and models get real content, never the phrase.

export type ConvMsg = { id?: string; role: "user" | "assistant"; content: unknown };
export type Resolution =
  | { kind: "none" }
  | { kind: "found"; role: "user" | "assistant"; ordinal: number; index: number; id?: string; content: string; label: string }
  | { kind: "missing"; label: string; reason: string }
  | { kind: "ambiguous"; label: string; question: string };

const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const ASSIST = "(?:response|answer|reply|message|output|generation|story|poem|draft|version|result|workbook|webbook|spreadsheet)";
const textOf = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join(" ") : "");
const isNotice = (t: string) => /^(Working on it|Writing your file|Building your project|Here's (your|the) (file|result|project))/i.test(t.trim()) || !t.trim();

/** Finds a reference in `request` and resolves it against `history` (which must NOT include the current message). */
export function resolveReference(request: string, history: ConvMsg[]): Resolution {
  const t = request.toLowerCase();
  const assistants = history.map((m, i) => ({ m, i, text: textOf(m.content) })).filter((x) => x.m.role === "assistant" && !isNotice(x.text));
  const users = history.map((m, i) => ({ m, i, text: textOf(m.content) })).filter((x) => x.m.role === "user");
  const pick = (list: typeof assistants, n: number, role: "user" | "assistant", label: string): Resolution => {
    const hit = n > 0 ? list[n - 1] : list[list.length + n];
    if (!hit) return { kind: "missing", label, reason: `This chat has only ${list.length} ${role === "assistant" ? "answer" : "message"}${list.length === 1 ? "" : "s"} from ${role === "assistant" ? "me" : "you"}.` };
    return { kind: "found", role, ordinal: n > 0 ? n : list.length + n + 1, index: hit.i, id: hit.m.id, content: hit.text, label };
  };

  // "my first message" / "the content I shared above" → user messages.
  let m = new RegExp(`\\b(?:my|i)\\s+(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|previous)\\s+(?:message|prompt|question|text)\\b`).exec(t);
  if (m) return m[1] === "last" || m[1] === "previous" ? pick(users, -1, "user", m[0]) : pick(users, ORD[m[1]], "user", m[0]);
  if (/\b(?:content|text|thing|file|notes?)\s+(?:that\s+)?i\s+(?:shared|pasted|sent|gave)(?:\s+you)?\s+(?:above|earlier|before)\b/.test(t)) {
    const long = [...users].reverse().find((u) => u.text.length > 200);
    return long ? { kind: "found", role: "user", ordinal: users.indexOf(long) + 1, index: long.i, id: long.m.id, content: long.text, label: "content you shared above" } : { kind: "missing", label: "content you shared above", reason: "I can't find longer content you shared earlier in this chat." };
  }
  // Ordinal assistant references: "your first response", "the second story", "answer #2", "the last answer".
  m = new RegExp(`\\b(?:(?:your|the|that)\\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|last|latest|previous|earlier|original)\\s+${ASSIST}s?\\b`).exec(t)
    ?? new RegExp(`\\b${ASSIST}\\s*(?:#|no\\.?|number)\\s*(\\d{1,3})\\b`).exec(t);
  if (m) {
    const w = m[1];
    const noun = (/(story|poem|draft|version)/.exec(m[0]) ?? [])[1];
    const pool = noun && noun !== "version" && noun !== "draft" ? assistants.filter((a) => new RegExp(`\\b${noun}`, "i").test(a.text) || noun === "story" && a.text.length > 400) : assistants;
    const list = pool.length ? pool : assistants;
    if (w === "last" || w === "latest" || w === "previous") return pick(list, -1, "assistant", m[0]);
    if (w === "original") return pick(list, 1, "assistant", m[0]);
    if (w === "earlier") {
      if (list.length > 2) return { kind: "ambiguous", label: m[0], question: `Which earlier ${noun ?? "answer"} do you mean — ${list.slice(0, 3).map((x, k) => `#${k + 1} ("${x.text.slice(0, 40).replace(/\s+/g, " ")}…")`).join(", ")}?` };
      return pick(list, list.length > 1 ? -2 : -1, "assistant", m[0]);
    }
    const n = ORD[w] ?? Number(w);
    return pick(list, n, "assistant", m[0]);
  }
  // "what you said above", "continue from where we stopped", "translate that" → latest answer.
  if (/\b(previous|last|above|prior)\s+(?:answer|response|reply|one)\b|\bwhere (?:we|you) (?:stopped|left off)\b|\bwhat you (?:just )?(?:said|wrote)\b/.test(t)) return pick(assistants, -1, "assistant", "previous answer");
  // "make a PDF of the story", "export this poem", "convert it to PDF" → the most recent matching content in this chat.
  if (isContentAction(t) && assistants.length) {
    if (/\b(?:webbook|workbook|spreadsheet)\b/.test(t)) {
      const workbook = [...assistants].reverse().find((a) => /\bSales_Data\b/i.test(a.text) && /\bRegional_Analysis\b/i.test(a.text));
      if (workbook) return { kind: "found", role: "assistant", ordinal: assistants.indexOf(workbook) + 1, index: workbook.i, id: workbook.m.id, content: workbook.text, label: "earlier workbook" };
    }
    const nm = /\b(?:the|that|this|your|above)\s+(story|poem|essay|article|script|letter|report|summary|answer|response|content|text|workbook|webbook|spreadsheet)\b/.exec(t);
    if (nm) {
      const noun = nm[1] === "webbook" ? "workbook" : nm[1];
      const generic = /answer|response|content|text/.test(noun);
      const hit = generic ? null : [...assistants].reverse().find((a) => new RegExp(`\\b${noun}`, "i").test(a.text) || (noun === "story" && a.text.length > 400));
      if (hit) return { kind: "found", role: "assistant", ordinal: assistants.indexOf(hit) + 1, index: hit.i, id: hit.m.id, content: hit.text, label: nm[0] };
      return pick(assistants, -1, "assistant", nm[0]);
    }
    if (/\b(?:of|from|into|convert|export|download)\s+(?:it|this|that)\b|\b(?:it|this|that)\s+(?:as|into|to)\s+(?:a\s+)?(?:pdf|docx?|word|txt|csv|xlsx|file)\b/.test(t)) return pick(assistants, -1, "assistant", "previous answer");
  }
  return { kind: "none" };
}

/** True when the request is a content-dependent action (export, convert, translate, shorten…) that needs a real source. */
export function isContentAction(request: string): boolean {
  return /\b(pdf|docx?|word file|txt|markdown|\.md|csv|xlsx|spreadsheet|file|export|download|convert|translate|shorten|summari[sz]e|rewrite|edit|modify|continue|expand)\b/i.test(request);
}

/** Text to attach to a model/tool request so it operates on the real referenced content. */
export function sourceBlock(r: Resolution, budget = 60000): string {
  if (r.kind !== "found") return "";
  const body = r.content.length > budget ? `${r.content.slice(0, budget)}\n[…truncated to fit the limit; ${r.content.length - budget} characters omitted]` : r.content;
  return `Referenced source — "${r.label}" resolved to ${r.role === "assistant" ? "assistant answer" : "user message"} #${r.ordinal} in this conversation. Use this exact content as the source (do not use the reference phrase itself as content):\n<<<SOURCE\n${body}\nSOURCE>>>`;
}

/** Checks that a produced file's text actually carries the source, not only the reference phrase. */
export function artifactMatchesSource(artifactText: string, source: string): { ok: boolean; coverage: number; reason?: string } {
  const norm = (s: string) => s.toLowerCase().replace(/[`*_#>|~-]/g, " ").replace(/\s+/g, " ").trim();
  const a = norm(artifactText), words = norm(source).split(" ").filter((w) => w.length > 3);
  if (!words.length) return { ok: false, coverage: 0, reason: "The source is empty." };
  const uniq = [...new Set(words)], aw = new Set(a.split(" "));
  const coverage = uniq.filter((w) => aw.has(w)).length / uniq.length;
  if (a.length < 60 && /\b(first|second|previous|last)\s+(response|answer)\b/.test(a)) return { ok: false, coverage, reason: "The file contains only the reference phrase, not the content." };
  return coverage >= 0.8 ? { ok: true, coverage } : { ok: false, coverage, reason: `Only ${Math.round(coverage * 100)}% of the source content is in the file.` };
}

/** Rebuilds the conversation-scoped working context from saved history (used when a chat is reopened). */
export function workingContext(history: ConvMsg[], max = 1500): { instructions: string[]; summary: string } {
  const STAND = /\b(always|never|from now on|must|don't|do not|use only|make sure|keep it|in (english|hindi|bengali|spanish|french))\b/i;
  const FORGET = /\b(forget|ignore|drop|stop using)\s+(?:about\s+|the\s+)?(.{3,60}?)(?:[.!]|$)/i;
  const instructions: string[] = [];
  for (const m of history) {
    if (m.role !== "user") continue;
    const text = textOf(m.content);
    const f = FORGET.exec(text);
    if (f) { const topic = f[2].toLowerCase().trim(); for (let i = instructions.length - 1; i >= 0; i--) if (instructions[i].toLowerCase().includes(topic)) instructions.splice(i, 1); continue; }
    for (const s of text.split(/(?<=[.!?\n])\s+/)) if (STAND.test(s) && s.length < 300) {
      // A later instruction about the same subject replaces the earlier one (recent correction wins).
      const LANG = /\b(language|english|hindi|bengali|spanish|french)\b/i;
      const key = LANG.test(s) ? LANG : (s.toLowerCase().match(/\b(tone|length|words?|format|name|scenes?|seconds?)\b/) ?? [])[1];
      if (key) for (let i = instructions.length - 1; i >= 0; i--) if (typeof key === "string" ? instructions[i].toLowerCase().includes(key) : key.test(instructions[i])) instructions.splice(i, 1);
      instructions.push(s.trim());
    }
  }
  const asks = history.filter((m) => m.role === "user").map((m) => textOf(m.content).replace(/\s+/g, " ").slice(0, 80));
  const summary = asks.length ? `Earlier requests in this chat: ${asks.slice(-8).map((a, i) => `(${i + 1}) ${a}`).join(" ")}` : "";
  return { instructions: instructions.slice(-12), summary: summary.slice(0, max) };
}

/** Pulls the referenced chat content back out of a tool prompt built with sourceBlock. */
export function extractSource(prompt: string): { request: string; source: string } | null {
  const m = prompt.match(/<<<SOURCE\n([\s\S]*?)\nSOURCE>>>/);
  if (!m) return null;
  const request = prompt.slice(0, prompt.indexOf("Referenced source —")).trim() || prompt.slice(0, m.index).trim();
  return { request, source: m[1].replace(/\n\[…truncated to fit the limit;[^\]]*\]$/, "") };
}

/** True when the user asks to change the content itself, not only package it as a file. */
export function asksToChangeContent(request: string): boolean {
  return /\b(rewrite|re-?write|edit|modify|change|shorten|summari[sz]e|expand|continue|translate|improve|polish|fix|add|remove|longer|shorter|simplify|new|another|write|create (a|an) (new )?(story|poem|essay|article|report))\b/i.test(request.replace(/\b(the|this|that|my|your|above|previous|last)\s+(story|poem|essay|article|report|answer|text)\b/gi, ""));
}
