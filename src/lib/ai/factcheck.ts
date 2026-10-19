// Evidence-based fact-checking for default chat answers. Pure: search, page fetch, correction and status are injected (tested with mocks).
// A claim is only "verified" when full source text supports it deterministically — never because a model agreed, never from a snippet alone.
import type { TaskStage } from "./task-events";

export type Evidence = {
  title: string; url: string; domain: string;
  /** Exact passage from the full page (or the search snippet when the page was unreadable). */
  passage: string;
  fullPage: boolean; retrievedAt: number; quality: 1 | 2 | 3; stale?: boolean;
};
export type ClaimStatus = "verified" | "contradicted" | "partial" | "conflicting" | "unverified";
export type ClaimRecord = { id: number; claim: string; status: ClaimStatus; support: Evidence[]; conflict: Evidence[]; excerpt?: string; checkedAt: number; reason?: string };
export type FactCheckResult = { text: string; records: ClaimRecord[]; unchecked: string[]; ran: boolean; corrected: boolean; searchFailed: boolean; rounds: number; pagesRead: number; pagesFailed: number };

export const FACTCHECK_LIMITS = { maxClaims: 6, resultsPerClaim: 3, maxPages: 10, maxCorrections: 1, minAnswerChars: 60 } as const;

const NUM = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%?/g;
const STOP = new Set("the a an in on of and or but it its this that these those is are was were be been being for to with by as at from also however note yes no i you we they he she here there what which who when where why how has have had do does did can could will would should may might must than then so such very more most many much some any each other into about over under after before between during known".split(" "));
const CAP_STOP = new Set("The A An In On Of And Or But It Its This That These Those Is Are Was Were For To With By As At From Also However Note Yes No I You We They He She Here There What Which Who When Where Why How Each Some Many Most".split(" "));
// Declarative factual shapes beyond numbers: definitions, locations, relationships, events, causes.
const FACT_SHAPE = /\b(is|are|was|were) (a|an|the|one of|located|known|considered|home to|famous|the capital)\b|\b(located in|capital of|founded|built|invented|discovered|signed|declared|born|died|borders?|consists? of|made of|caused|causes|because|due to|led to|results? in|known for|famous for|home to|part of|belongs? to|named after|originated)\b/i;
const NOT_FACT = /^(i think|i believe|in my opinion|you (can|should|could|might|may)|let'?s|feel free|try|use|click|open|make sure|remember|consider|here (is|are)|sure|great|hope)\b|\b(might|perhaps|probably|i'd|we'd)\b/i;
const RISK = /\b(dose|dosage|mg|medic|drug|disease|symptom|law|legal|illegal|tax|interest rate|price|cost|salary|population|death|deaths|percent|%|gdp|vaccine|treatment)\b/i;
const CHANGING = /\b(currently|current|now|today|latest|as of|recent(ly)?|this year|present)\b/i;

const keyTerms = (s: string) => [...new Set((s.match(/\b[A-Z][a-zA-Z\u00C0-\u024F'-]{2,}\b/g) ?? []).filter((w) => !CAP_STOP.has(w)))];
const numbers = (s: string) => [...new Set((s.match(NUM) ?? []).map((n) => n.replace(/,/g, "")))];
const contentWords = (s: string) => [...new Set(s.toLowerCase().replace(/,(?=\d{3})/g, "").match(/[a-z\u00C0-\u024F][a-z\u00C0-\u024F'-]{2,}|\d+(?:\.\d+)?%?/g) ?? [])].filter((w) => !STOP.has(w));

/** Creative, code, opinion and conversational requests are not fact-checked. */
export function needsFactCheck(request: string, answer: string): boolean {
  if (answer.length < FACTCHECK_LIMITS.minAnswerChars) return false;
  // Calculations on the user's own figures are checked by arithmetic validators, not web pages.
  if (/\b(calculat\w*|comput\w*|solve|work out|evaluate|how much will|monthly payment|amortization|compound interest)\b/i.test(request)) return false;
  if (/\b(write|compose|draft|poem|story|lyrics|joke|imagine|fiction|code|function|script|regex|translate|rewrite|paraphrase|summari[sz]e (this|the following))\b/i.test(request)) return false;
  // Facts about the user, their project or this conversation come from memory/context, not the web.
  if (/\b(my|mine|our|ours|we|us|this (project|chat|conversation)|decision|acknowledge|remember|forget)\b/i.test(request)) return false;
  return allClaims(answer).length > 0;
}

/** Headings/labels ("Blood Path (Numbered List)") are not statements: short, unpunctuated, mostly capitalised. */
function isTitle(s: string): boolean {
  const w = s.split(" ");
  return !/[.!;]$/.test(s) && w.length <= 8 && w.filter((x) => /^[A-Z(]/.test(x)).length >= Math.ceil(w.length * 0.6);
}

/** Every material, verifiable statement in the answer, ordered by importance/risk (most important first). */
export function allClaims(answer: string): string[] {
  const prose = answer.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/^\s*>\s*\[![A-Z]+\][\s\S]*$/m, " ").replace(/^\s{0,3}#{1,6}\s.*$/gm, " ");
  const sentences = prose
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[\s>*#|\-\d.)]+/, "").replace(/[*_|]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20 && s.length <= 400 && !/\?$/.test(s) && !NOT_FACT.test(s) && !isTitle(s));
  const scored = sentences
    .map((s, i) => {
      const n = numbers(s).length, k = keyTerms(s).length, shape = FACT_SHAPE.test(s);
      const ok = (n > 0 && k > 0) || k >= 2 || (shape && (k > 0 || contentWords(s).length >= 4));
      return { s, i, ok, score: n * 3 + k + (shape ? 2 : 0) + (RISK.test(s) ? 4 : 0) };
    })
    .filter((x) => x.ok);
  const seen = new Set<string>();
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s).filter((s) => !seen.has(s) && seen.add(s));
}

export const extractClaims = (answer: string) => allClaims(answer).slice(0, FACTCHECK_LIMITS.maxClaims);

/** Search query for one claim: its entities, figures and key words, not the full sentence. */
export function claimQuery(claim: string): string {
  const k = keyTerms(claim).slice(0, 5), n = numbers(claim).slice(0, 2);
  const extra = k.length < 2 ? contentWords(claim).filter((w) => !/^\d/.test(w)).slice(0, 6) : [];
  return [...k, ...extra, ...n].join(" ") || claim.slice(0, 120);
}

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/** Source quality: 3 = official/primary/institutional, 2 = established reference or wire service, 1 = other. */
export function sourceQuality(url: string): 1 | 2 | 3 {
  const d = domainOf(url);
  if (/(^|\.)(gov|mil|int|edu)(\.[a-z]{2})?$|(^|\.)(gov|nic|ac|edu)\.[a-z]{2}$|(^|\.)(who\.int|un\.org|europa\.eu|worldbank\.org|imf\.org|oecd\.org|nature\.com|science\.org|nih\.gov|census\.gov)$/.test(d)) return 3;
  if (/(^|\.)(wikipedia\.org|britannica\.com|reuters\.com|apnews\.com|bbc\.(co\.uk|com)|nationalgeographic\.com|statista\.com|unesco\.org|nytimes\.com|theguardian\.com)$/.test(d)) return 2;
  return 1;
}

/** Best supporting/contradicting passages in a page: sentence windows ranked by overlap with the claim. */
export function findPassages(claim: string, page: string, max = 2): string[] {
  const words = contentWords(claim);
  if (!words.length) return [];
  const sents = page.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.length > 20 && s.length < 1200);
  const ranked = sents.map((s, i) => {
    const win = `${s} ${sents[i + 1] ?? ""}`.trim();
    const lw = win.toLowerCase().replace(/,(?=\d{3})/g, "");
    return { win, hits: words.filter((w) => lw.includes(w)).length };
  }).filter((x) => x.hits / words.length >= 0.35).sort((a, b) => b.hits - a.hits);
  return [...new Set(ranked.slice(0, max).map((r) => r.win.slice(0, 600)))];
}

function sameKind(a: string, b: string): boolean {
  const year = (x: string) => /^(1[5-9]|20)\d\d$/.test(x);
  if (year(a) || year(b)) return year(a) && year(b);
  return a.endsWith("%") === b.endsWith("%") && a !== b && Math.abs(Math.log10(+a.replace("%", "") + 1) - Math.log10(+b.replace("%", "") + 1)) < 1;
}
const NEG = /\b(not|never|no longer|isn't|wasn't|aren't|weren't|neither|nor)\b/i;

function isStale(claim: string, passage: string, now: number): boolean {
  if (!CHANGING.test(claim)) return false;
  const y = new Date(now).getUTCFullYear();
  const years = numbers(passage).filter((n) => /^(19|20)\d\d$/.test(n)).map(Number);
  return years.length > 0 && Math.max(...years) < y - 2;
}

/** Deterministic judgement of one claim against evidence passages. Snippet-only evidence can never verify. */
export function judgeClaim(id: number, claim: string, evidence: Evidence[], now = Date.now()): ClaimRecord {
  const terms = keyTerms(claim).map((t) => t.toLowerCase());
  const words = contentWords(claim);
  const nums = numbers(claim);
  const support: Evidence[] = [], conflict: Evidence[] = [], partial: Evidence[] = [];
  for (const e0 of evidence) {
    const e = { ...e0, stale: e0.stale ?? isStale(claim, e0.passage, now) };
    const text = `${e.title} ${e.passage}`.toLowerCase().replace(/,(?=\d{3})/g, "");
    const termHits = terms.filter((t) => text.includes(t)).length;
    if (terms.length && termHits / terms.length < 0.5) continue;
    const overlap = words.length ? words.filter((w) => text.includes(w)).length / words.length : 0;
    if (!terms.length && overlap < 0.5) continue;
    const numHits = nums.filter((n) => new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(text)).length;
    const allTerms = termHits === terms.length;
    let verdict: "support" | "conflict" | "partial";
    if (nums.length) {
      if (numHits === nums.length && overlap >= 0.5) verdict = "support";
      else if (numHits === 0 && allTerms && nums.some((n) => numbers(text).some((m) => sameKind(n, m)))) verdict = "conflict";
      else verdict = "partial";
    } else {
      // Non-numeric claims: near-complete wording overlap supports; the same statement with opposite polarity conflicts.
      const polarityFlip = NEG.test(claim) !== NEG.test(e.passage);
      if (overlap >= 0.75 && allTerms) verdict = polarityFlip ? "conflict" : "support";
      else verdict = "partial";
    }
    if (verdict !== "partial" && (!e.fullPage || e.stale)) verdict = "partial"; // snippet alone or outdated → never proof either way
    (verdict === "support" ? support : verdict === "conflict" ? conflict : partial).push(e);
  }
  // Independence: one vote per domain, and identical passages on different domains count once.
  const independent = new Set(support.map((e) => e.domain)).size;
  const strong = support.some((e) => e.quality >= 2) || independent >= 2;
  let status: ClaimStatus;
  let reason: string | undefined;
  if (support.length && conflict.length) { status = "conflicting"; reason = "Sources disagree"; }
  else if (conflict.length) { status = "contradicted"; reason = "Sources state otherwise"; }
  else if (support.length && strong) status = "verified";
  else if (support.length || partial.length) { status = "partial"; reason = support.length ? "Only one lower-quality source" : partial.some((e) => e.stale) ? "Only outdated evidence" : partial.every((e) => !e.fullPage) ? "Only search summaries, page not readable" : "Sources only partly match"; }
  else { status = "unverified"; reason = "No relevant evidence found"; }
  const best = (status === "contradicted" ? conflict : support.length ? support : conflict.length ? conflict : partial).sort((a, b) => b.quality - a.quality)[0];
  return { id, claim, status, support, conflict, excerpt: best?.passage.slice(0, 280), checkedAt: now, ...(reason ? { reason } : {}) };
}

const UNREADABLE = /^news\.google\.com$/;
export type SearchHit = { title: string; url: string; snippet: string };
export type FactCheckDeps = {
  search: (query: string) => Promise<{ ok: boolean; results: SearchHit[] }>;
  /** Reads a full page as plain text; null when inaccessible. */
  fetchPage?: (url: string) => Promise<string | null>;
  /** Rewrites only the listed claims using the given evidence; returns the full corrected answer (or null). */
  correct?: (answer: string, problems: ClaimRecord[]) => Promise<string | null>;
  emit?: (stage: TaskStage, message?: string) => void;
  /** Results already retrieved for this request (reused before new searches). */
  initial?: SearchHit[];
  now?: () => number;
};

type Cache = { searches: Map<string, { ok: boolean; results: SearchHit[] }>; pages: Map<string, string | null>; pagesRead: number; pagesFailed: number };

async function verify(text: string, deps: FactCheckDeps, cache: Cache) {
  const emit = deps.emit ?? (() => {});
  const now = deps.now?.() ?? Date.now();
  const claims = extractClaims(text);
  let searchFailed = false;
  const queries = claims.map(claimQuery);
  const fresh = [...new Set(queries.filter((q) => !cache.searches.has(q)))];
  if (fresh.length) emit("searching_web", `Looking up ${fresh.length} claim${fresh.length === 1 ? "" : "s"}`);
  for (const q of fresh) cache.searches.set(q, await deps.search(q).catch(() => ({ ok: false, results: [] })));
  const hitsPer = queries.map((q) => {
    const r = cache.searches.get(q)!;
    if (!r.ok) searchFailed = true;
    const seen = new Set<string>();
    // Readable, higher-quality sources first; news-aggregator redirect pages can't be read as full text.
    const rank = (h: SearchHit) => (UNREADABLE.test(domainOf(h.url)) ? -1 : sourceQuality(h.url));
    return [...r.results, ...(deps.initial ?? [])].filter((h) => h.url && !seen.has(h.url) && seen.add(h.url)).sort((a, b) => rank(b) - rank(a)).slice(0, FACTCHECK_LIMITS.resultsPerClaim + 2);
  });
  // Full pages, each fetched at most once per answer, within the page budget.
  const toRead = [...new Set(hitsPer.flatMap((h) => h.slice(0, FACTCHECK_LIMITS.resultsPerClaim).map((x) => x.url)))].filter((u) => !cache.pages.has(u) && !UNREADABLE.test(domainOf(u)));
  const budget = Math.max(0, FACTCHECK_LIMITS.maxPages - cache.pages.size);
  const reading = deps.fetchPage ? toRead.slice(0, budget) : [];
  if (reading.length) emit("reading_sources", `Reading ${reading.length} source${reading.length === 1 ? "" : "s"}`);
  await Promise.all(reading.map(async (u) => {
    const page = await deps.fetchPage!(u).catch(() => null);
    cache.pages.set(u, page && page.length > 200 ? page : null);
    if (cache.pages.get(u)) cache.pagesRead++; else cache.pagesFailed++;
  }));
  const evidence: Evidence[][] = claims.map((c, i) => hitsPer[i].flatMap((h): Evidence[] => {
    const base = { title: h.title, url: h.url, domain: domainOf(h.url), retrievedAt: now, quality: sourceQuality(h.url) };
    const page = cache.pages.get(h.url);
    const passages = page ? findPassages(c, page) : [];
    if (passages.length) return passages.map((p) => ({ ...base, passage: p, fullPage: true }));
    return h.snippet ? [{ ...base, passage: h.snippet, fullPage: false }] : [];
  }));
  if (evidence.some((e) => new Set(e.map((x) => x.domain)).size > 1)) emit("comparing_sources");
  emit("fact_checking", `Checking ${claims.length} claim${claims.length === 1 ? "" : "s"}`);
  return { records: claims.map((c, i) => judgeClaim(i + 1, c, evidence[i], now)), searchFailed };
}

/** Verify → (correct contradicted claims → re-verify), bounded. Returns the answer plus an honest, scoped verification note. */
export async function runFactCheck(answer: string, deps: FactCheckDeps): Promise<FactCheckResult> {
  const emit = deps.emit ?? (() => {});
  const cache: Cache = { searches: new Map(), pages: new Map(), pagesRead: 0, pagesFailed: 0 };
  if (!allClaims(answer).length) return { text: answer, records: [], unchecked: [], ran: false, corrected: false, searchFailed: false, rounds: 0, pagesRead: 0, pagesFailed: 0 };
  emit("verifying_accuracy");
  let text = answer, corrected = false, rounds = 1;
  let { records, searchFailed } = await verify(text, deps, cache);
  for (let i = 0; i < FACTCHECK_LIMITS.maxCorrections && deps.correct; i++) {
    const bad = records.filter((r) => r.status === "contradicted");
    if (!bad.length) break;
    emit("detecting_issues", `${bad.length} claim${bad.length === 1 ? "" : "s"} contradicted by sources`);
    emit("fixing_issues");
    const fixed = await deps.correct(text, bad).catch(() => null);
    if (!fixed?.trim()) break;
    text = fixed; corrected = true; rounds++;
    emit("verifying_accuracy", "Re-checking corrected claims");
    ({ records, searchFailed } = await verify(text, deps, cache));
  }
  const unchecked = allClaims(text).slice(FACTCHECK_LIMITS.maxClaims);
  return { text: text + disclosure(records, unchecked.length, searchFailed), records, unchecked, ran: true, corrected, searchFailed, rounds, pagesRead: cache.pagesRead, pagesFailed: cache.pagesFailed };
}

const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const link = (e: Evidence) => `[${(e.title.replace(/[[\]]/g, "").slice(0, 60) || e.domain)}](${e.url})`;

/** Scoped verification note: what was checked, how each checked claim fared, and its own sources. */
export function disclosure(records: ClaimRecord[], uncheckedCount: number, searchFailed: boolean): string {
  if (!records.length) return "";
  const count = (s: ClaimStatus) => records.filter((r) => r.status === s).length;
  const parts = [
    `${count("verified")} confirmed`,
    count("partial") && `${count("partial")} partly supported`,
    count("conflicting") && `${count("conflicting")} with conflicting sources`,
    count("contradicted") && `${count("contradicted")} contradicted`,
    count("unverified") && `${count("unverified")} not confirmed`,
  ].filter(Boolean).join(", ");
  const scope = `Fact-check: ${records.length} key statement${records.length === 1 ? " was" : "s were"} checked against sources (${parts}).${uncheckedCount ? ` ${uncheckedCount} other statement${uncheckedCount === 1 ? " was" : "s were"} not checked.` : ""}${searchFailed ? " Web search was partly unavailable." : ""}`;
  const mark: Record<ClaimStatus, string> = { verified: "Confirmed", partial: "Partly supported", conflicting: "Sources conflict", contradicted: "Contradicted", unverified: "Not confirmed" };
  const lines = records.map((r) => {
    const srcs = [...new Map((r.status === "contradicted" || r.status === "conflicting" ? [...r.support, ...r.conflict] : r.support.length ? r.support : r.conflict).map((e) => [e.url, e])).values()].slice(0, 2);
    return `> - **${mark[r.status]}:** "${short(r.claim)}"${srcs.length ? ` — ${srcs.map(link).join(", ")}` : r.reason ? ` — ${r.reason.toLowerCase()}` : ""}`;
  });
  return `\n\n> [!NOTE]\n> ${scope}\n${lines.join("\n")}`;
}
