// Deep Thinking Mode — task execution engine.
// Analyze → Plan → Decompose → Generate individually → Verify individually → Correct → Final validation → Deliver.
// Pure orchestration: model calls, persistence, clock and sleep are injected, so every path is unit-tested with mocks.
import type { RequestAnalysis } from "./analyze";
import { planDurations } from "./durations";
import type { CallResult, ChatMsg, ModelCall } from "./pipeline";
import { parseReview } from "./pipeline";
import { checkComplete, checkStructure, extractDurations, type Issue } from "./validators";

export type TaskStatus = "pending" | "generating" | "generated" | "verifying" | "needs_correction" | "verified" | "failed" | "blocked";
export type Revision = { rev: number; output: string; findings: string[]; at: number; kind: "generate" | "correct" };
export type DeepTask = {
  id: string;
  index: number;
  title: string;
  spec: string;
  criteria: string[];
  dependsOn: string[];
  /** Deterministic per-task requirement (e.g. a planned clip length). */
  requiredDuration?: number;
  status: TaskStatus;
  output: string | null;
  findings: string[];
  reviewed: boolean;
  revisions: Revision[];
  attempts: number;
  rev: number;
};
export type ExecutionLimits = {
  maxCorrectionsPerTask: number;
  maxTotalAttempts: number;
  maxFinalRounds: number;
  budgetMs: number;
  concurrency: number;
  maxRetries: number;
  retryBaseMs: number;
  contextCharBudget: number;
  maxContinuations: number;
};
export type ExecutionState = {
  executionId: string;
  requestId: string;
  conversationId?: string;
  plan: { concept: string; shared: string[]; source: "model" | "fallback" };
  tasks: DeepTask[];
  limits: ExecutionLimits;
  totalAttempts: number;
  finalValidation: "pending" | "passed" | "failed" | "unverified";
  finalFindings: string[];
  overall: "running" | "completed" | "incomplete" | "failed";
  result?: string;
  createdAt: number;
  updatedAt: number;
};
export type StateStore = { load(requestId: string): Promise<ExecutionState | null>; save(s: ExecutionState): Promise<void> };
export type ProgressStage = "analyzing" | "planning" | "generating" | "verifying" | "correcting" | "validating" | "assembling";
export type Progress = (stage: ProgressStage, detail?: string) => void;

export const ENGINE_LIMITS: ExecutionLimits = {
  maxCorrectionsPerTask: 2, maxTotalAttempts: 40, maxFinalRounds: 2, budgetMs: 170_000,
  concurrency: 4, maxRetries: 2, retryBaseMs: 800, contextCharBudget: 32_000, maxContinuations: 2,
};

/** Requests with a fixed number of separate deliverables are decomposed; everything else uses the single-answer pipeline. */
export function shouldDecompose(a: RequestAnalysis): boolean {
  // Paragraphs/sentences/lines/bullets are parts of ONE text: writing them separately breaks flow and is slow.
  return !!a.items && a.items.count >= 2 && a.items.count <= 20 && !a.wantsJson && !TEXT_UNITS.test(a.items.noun) && !CONTINUOUS_STORY.test(a.items.noun);
}

/** Scenes/chapters of one story share plot and object state: they go through the planned, whole-story-validated pipeline. */
const CONTINUOUS_STORY = /^(scene|chapter|episode|panel|beat|shot)s?$/i;

const TEXT_UNITS = /^(paragraph|sentence|line|bullet|bullet point|point|word|verse|stanza)s?$/i;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[shortened]` : s);

/** Transient failures (rate limits, timeouts, 5xx, empty/malformed replies) retry with exponential backoff; permanent ones never do. */
export async function callWithRetry(call: ModelCall, msgs: ChatMsg[], L: ExecutionLimits, sleep: (ms: number) => Promise<void>, over: () => boolean = () => false): Promise<CallResult & { tries: number }> {
  let last: CallResult = { ok: false, status: 502, reason: "not called" };
  let i = 0;
  for (; i <= L.maxRetries; i++) {
    if (i) { if (over()) break; await sleep(L.retryBaseMs * 2 ** (i - 1)); } // retries never pass the execution budget
    let r: CallResult;
    try { r = await call(msgs); } catch (e: any) { r = { ok: false, status: 502, reason: String(e?.message ?? e) }; }
    if (r.ok && r.text.trim()) return { ...r, tries: i + 1 };
    last = r.ok ? { ok: false, status: 502, reason: "malformed or empty model response" } : r;
    if (!last.ok && !(last.status === 429 || last.status >= 500)) { i++; break; }
  }
  return { ...last, tries: Math.min(i, L.maxRetries + 1) };
}

/** First balanced JSON object in a reply (ignores fences and chatter). */
export function extractJson(text: string): any {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  for (let s = t.indexOf("{"); s >= 0; s = t.indexOf("{", s + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = s; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { try { return JSON.parse(t.slice(s, i + 1)); } catch { break; } }
    }
  }
  return null;
}

const PLAN_SYSTEM = (n: number, noun: string) => `You are the planning stage of a careful assistant. Do NOT write the deliverables. Build the base structure for exactly ${n} separate ${noun}s that together fulfil the user's request.
Reply with JSON only:
{"concept":"one paragraph: overall idea, sequence, style and continuity rules","shared":["fact/constraint every ${noun} must respect (characters, setting, style, variables, tone)"],"tasks":[{"title":"short title","spec":"what this ${noun} must contain and its purpose in the whole","criteria":["checkable acceptance criterion"],"dependsOn":[]}]}
Rules: exactly ${n} tasks, in final order. "dependsOn" lists earlier task numbers (1-based) whose output this task needs; leave empty when independent. Use only facts from the request; record genuinely missing information as a shared assumption starting with "Assumption:".`;

/** Builds the plan from the model, falling back to a deterministic structure if the plan is missing or malformed. */
export function buildTasks(raw: any, a: RequestAnalysis): { plan: ExecutionState["plan"]; tasks: DeepTask[] } {
  const n = a.items!.count, noun = a.items!.noun;
  const list: any[] = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const valid = list.length === n && list.every((t) => t && typeof t.spec === "string" && t.spec.trim());
  const durations = a.allowedDurations && a.totalDuration && ["scene", "clip", "shot"].includes(noun) ? planDurations(Math.round(a.totalDuration), a.allowedDurations, n) : null;
  const tasks: DeepTask[] = Array.from({ length: n }, (_, i) => {
    const t = valid ? list[i] : null;
    const criteria = (Array.isArray(t?.criteria) ? t.criteria : []).filter((c: unknown) => typeof c === "string" && c.trim()).slice(0, 8).map((c: string) => c.slice(0, 300));
    criteria.push(`Contains only ${noun} ${i + 1} — no other ${noun}s, no preamble about the other parts.`);
    const requiredDuration = durations?.[i];
    if (requiredDuration) criteria.push(`States its length exactly as "Duration: ${requiredDuration}s".`);
    else if (a.allowedDurations) criteria.push(`States its length as "Duration: Ns" using only ${a.allowedDurations.join("/")} seconds.`);
    const deps = (Array.isArray(t?.dependsOn) ? t.dependsOn : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= i).map((d: number) => `T${d}`);
    return {
      id: `T${i + 1}`, index: i,
      title: typeof t?.title === "string" && t.title.trim() ? t.title.trim().slice(0, 120) : `${cap(noun)} ${i + 1}`,
      spec: t ? String(t.spec).slice(0, 1500) : `Write ${noun} ${i + 1} of ${n} for the user's request, continuing naturally from the previous ${noun}s.`,
      criteria, dependsOn: [...new Set(deps)] as string[], requiredDuration,
      status: "pending", output: null, findings: [], reviewed: false, revisions: [], attempts: 0, rev: 0,
    };
  });
  const shared = (Array.isArray(raw?.shared) ? raw.shared : []).filter((s: unknown) => typeof s === "string").slice(0, 12).map((s: string) => s.slice(0, 400));
  return { plan: { concept: valid && typeof raw?.concept === "string" ? raw.concept.slice(0, 2000) : "", shared: valid ? shared : [], source: valid ? "model" : "fallback" }, tasks };
}

/** Task-specific context. Essential parts (request, task, criteria) are never cut; if they alone exceed the budget the task is blocked. */
export function buildTaskContext(s: ExecutionState, t: DeepTask, request: string, extra = ""): { text: string } | { blocked: string } {
  const n = s.tasks.length;
  const essential = [
    `Original user request:\n${request}`,
    `Your task: ${t.id} — part ${t.index + 1} of ${n}: "${t.title}"\n${t.spec}`,
    `Acceptance criteria (all must hold):\n- ${t.criteria.join("\n- ")}`,
    extra,
  ].filter(Boolean).join("\n\n");
  if (essential.length > s.limits.contextCharBudget) return { blocked: `The task's essential instructions (${essential.length} chars) exceed the model context budget (${s.limits.contextCharBudget}); it was not run rather than silently cutting requirements.` };
  let room = s.limits.contextCharBudget - essential.length;
  const optional: string[] = [];
  const structure = [s.plan.concept && `Approved base structure:\n${s.plan.concept}`, s.plan.shared.length ? `Shared facts and constraints:\n- ${s.plan.shared.join("\n- ")}` : "", `All parts in order:\n${s.tasks.map((x) => `${x.index + 1}. ${x.title}`).join("\n")}`].filter(Boolean).join("\n\n");
  if (structure.length <= room) { optional.push(structure); room -= structure.length; }
  else { optional.push(clip(structure, Math.max(0, room - 20))); room = 0; }
  for (const d of t.dependsOn) {
    const dep = s.tasks.find((x) => x.id === d);
    if (!dep?.output || room < 200) continue;
    const block = `Output of ${dep.id} ("${dep.title}") that this part builds on:\n${clip(dep.output, Math.min(6000, room - 100))}`;
    optional.push(block); room -= block.length;
  }
  return { text: [essential.split("\n\n")[0], ...optional, ...essential.split("\n\n").slice(1)].join("\n\n") };
}

const TASK_SYSTEM = (base: string) => `${base}\n\nYou are producing ONE part of a larger answer that is assembled automatically. Output only this part's content: no label/heading for the part number, no other parts, no commentary about the process.`;
const TASK_REVIEW = "You are a strict independent verifier. Check ONE generated part against its task specification and acceptance criteria. Do not judge style or fluency. For every criterion decide if it is met. Reply with exactly PASS if every criterion is met and nothing is factually or logically wrong; otherwise reply 'ISSUES:' and one '- ' bullet per unmet criterion or concrete error. Do not rewrite the part.";
const FINAL_REVIEW = "You are a strict final validator. You receive the shared plan and all parts of an answer. Check cross-part consistency only: characters, names, environment, style, variables, facts, numbering and narrative/logical continuity must agree with the plan and with each other. Reply with exactly PASS if consistent. Otherwise reply one line per problem: 'CONFLICT T<number>: <what is inconsistent and how it should change>' naming the part that should change (the smallest set).";

/** Deterministic checks for one task output. */
export function verifyTaskDeterministic(t: DeepTask, output: string, finish: string | null, noun: string, total: number): Issue[] {
  const issues = checkComplete(output, finish).filter((i) => i.code !== "truncated" || finish === "length");
  issues.push(...checkStructure(output));
  if (t.requiredDuration) {
    const d = extractDurations(output);
    if (d.length !== 1 || d[0] !== t.requiredDuration) issues.push({ code: "duration_task", message: `Must state exactly one length "Duration: ${t.requiredDuration}s" (found ${d.length ? d.map((x) => `${x}s`).join(", ") : "none"}).` });
  }
  const others = [...output.matchAll(new RegExp(`^\\s{0,3}(?:#{1,6}\\s*)?(?:[*_]{1,2})?${noun}s?\\s*#?(\\d{1,3})\\b`, "gim"))].map((m) => Number(m[1])).filter((x) => x !== t.index + 1 && x >= 1 && x <= total);
  if (others.length) issues.push({ code: "foreign_item", message: `Contains other ${noun}(s) ${[...new Set(others)].join(", ")}; only ${noun} ${t.index + 1} belongs here.` });
  return issues;
}

export function parseConflicts(text: string, n: number): { pass: boolean; conflicts: { id: string; reason: string }[] } {
  const t = text.trim();
  const conflicts = [...t.matchAll(/CONFLICT\s*\**\s*T?(\d{1,3})\**\s*[:\-–]\s*(.+)/gi)].map((m) => ({ id: `T${Number(m[1])}`, reason: m[2].trim().slice(0, 400) })).filter((c) => Number(c.id.slice(1)) >= 1 && Number(c.id.slice(1)) <= n);
  if (!conflicts.length && /^\**PASS\b/i.test(t)) return { pass: true, conflicts: [] };
  return { pass: false, conflicts };
}

export type EngineOptions = {
  request: string;
  requestId: string;
  conversationId?: string;
  analysis: RequestAnalysis;
  baseSystem: string;
  call: ModelCall;
  /** Optional separate model for verification (independent evidence); defaults to `call`. */
  reviewCall?: ModelCall;
  store?: StateStore;
  progress?: Progress;
  limits?: Partial<ExecutionLimits>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: Record<string, unknown>) => void;
};

export type EngineResult = { text: string; state: ExecutionState; calls: number; reused: boolean };

export async function runDeepEngine(o: EngineOptions): Promise<EngineResult> {
  const L: ExecutionLimits = { ...ENGINE_LIMITS, ...o.limits };
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const progress = o.progress ?? (() => {});
  const log = o.log ?? (() => {});
  const noun = o.analysis.items!.noun, N = o.analysis.items!.count;
  const t0 = now();
  const over = () => now() - t0 > L.budgetMs;
  let calls = 0;
  const call = async (msgs: ChatMsg[], review = false) => { calls++; const r = await callWithRetry(review && o.reviewCall ? o.reviewCall : o.call, msgs, L, sleep, over); return r; };

  // Persistence / duplicate prevention: a finished execution for this request is returned as-is; an interrupted one resumes.
  let state = (await o.store?.load(o.requestId).catch(() => null)) ?? null;
  if (state?.overall === "completed" && state.result) { log({ stage: "reuse", executionId: state.executionId }); return { text: state.result, state, calls: 0, reused: true }; }
  const save = async () => { if (!state) return; state.updatedAt = now(); await o.store?.save(state).catch((e) => log({ stage: "persist-failed", error: String(e) })); };

  if (state && state.tasks.length === N) {
    for (const t of state.tasks) if (t.status !== "verified") { t.status = "pending"; t.findings = []; }
    state.overall = "running"; state.finalValidation = "pending"; state.limits = L;
    log({ stage: "resume", executionId: state.executionId, kept: state.tasks.filter((t) => t.status === "verified").map((t) => t.id) });
  } else {
    progress("analyzing");
    progress("planning", `${N} ${noun}s`);
    const p = await call([{ role: "system", content: PLAN_SYSTEM(N, noun) }, { role: "user", content: o.request }]);
    const built = buildTasks(p.ok ? extractJson(p.text) : null, o.analysis);
    state = { executionId: crypto.randomUUID(), requestId: o.requestId, conversationId: o.conversationId, plan: built.plan, tasks: built.tasks, limits: L, totalAttempts: 0, finalValidation: "pending", finalFindings: [], overall: "running", createdAt: now(), updatedAt: now() };
    log({ stage: "plan", source: built.plan.source, tasks: N, deps: built.tasks.filter((t) => t.dependsOn.length).map((t) => `${t.id}<-${t.dependsOn.join("+")}`) });
    await save();
  }
  const S = state;

  const generate = async (t: DeepTask, kind: "generate" | "correct", extra = "") => {
    if (S.totalAttempts >= L.maxTotalAttempts || over()) { t.status = "failed"; t.findings.push("Execution limit reached before this part could be generated."); return; }
    const ctx = buildTaskContext(S, t, o.request, extra);
    if ("blocked" in ctx) { t.status = "blocked"; t.findings = [ctx.blocked]; return; }
    const dispatchedRev = t.rev;
    t.status = "generating"; t.attempts++; S.totalAttempts++;
    const msgs: ChatMsg[] = [{ role: "system", content: TASK_SYSTEM(o.baseSystem) }, { role: "user", content: ctx.text }];
    let r = await call(msgs);
    if (!r.ok) { t.status = r.status === 499 ? "blocked" : "failed"; t.findings = [`Generation failed (${r.status}): ${r.reason.slice(0, 160)}`]; return; }
    let text = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), finish = r.finishReason, cont = 0;
    while (finish === "length" && cont++ < L.maxContinuations && !over()) {
      const c = await call([...msgs, { role: "assistant", content: text }, { role: "user", content: "Continue exactly where you stopped. Do not repeat anything." }]);
      if (!c.ok) break;
      text += c.text; finish = c.finishReason;
    }
    if (t.rev !== dispatchedRev) return; // a newer revision was accepted meanwhile; never overwrite it with a stale one
    t.rev++; t.output = text; t.status = "generated";
    t.revisions.push({ rev: t.rev, output: text, findings: [], at: now(), kind });
    (t as any)._finish = finish;
  };

  const verify = async (t: DeepTask): Promise<boolean> => {
    if (t.status !== "generated" || !t.output) return false;
    t.status = "verifying";
    const det = verifyTaskDeterministic(t, t.output, (t as any)._finish ?? "stop", noun, N);
    let findings = det.map((i) => i.message);
    t.reviewed = false;
    if (!det.length && !over()) {
      const r = await call([{ role: "system", content: TASK_REVIEW }, { role: "user", content: `Original request:\n${clip(o.request, 8000)}\n\nTask ${t.id} (part ${t.index + 1} of ${N}): ${t.title}\n${t.spec}\n\nAcceptance criteria:\n- ${t.criteria.join("\n- ")}\n${S.plan.shared.length ? `\nShared constraints:\n- ${S.plan.shared.join("\n- ")}\n` : ""}\nGenerated part:\n${clip(t.output, 20000)}` }], true);
      if (r.ok) { const v = parseReview(r.text); t.reviewed = true; findings = v.issues; }
    }
    t.findings = findings;
    t.revisions[t.revisions.length - 1].findings = findings;
    t.status = findings.length ? "needs_correction" : "verified";
    log({ stage: "verify", task: t.id, rev: t.rev, deterministic: det.length, reviewed: t.reviewed, status: t.status });
    return !findings.length;
  };

  const correctLoop = async (t: DeepTask, crossContext = "") => {
    let n = 0;
    while (t.status === "needs_correction" && n < L.maxCorrectionsPerTask && !over()) {
      n++;
      progress("correcting", `${cap(noun)} ${t.index + 1}`);
      const extra = `${crossContext}Previous version of this part:\n${clip(t.output ?? "", 12000)}\n\nVerification found these problems:\n- ${t.findings.join("\n- ")}\n\nReturn the complete corrected part only. Keep everything that was already correct.`;
      await generate(t, "correct", extra);
      if ((t.status as TaskStatus) !== "generated") break;
      progress("verifying", `${cap(noun)} ${t.index + 1}`);
      await verify(t);
    }
    if (t.status === "needs_correction") t.status = "failed";
  };

  const runTask = async (t: DeepTask) => {
    progress("generating", `${cap(noun)} ${t.index + 1} of ${N}`);
    await generate(t, "generate");
    if (t.status === "generated") { progress("verifying", `${cap(noun)} ${t.index + 1}`); await verify(t); }
    if (t.status === "needs_correction") await correctLoop(t);
    await save();
  };

  // Dependency-aware waves with bounded concurrency; each task is its own generation request.
  for (;;) {
    const ready = S.tasks.filter((t) => t.status === "pending" && t.dependsOn.every((d) => S.tasks.find((x) => x.id === d)?.status === "verified"));
    const waiting = S.tasks.filter((t) => t.status === "pending");
    if (!ready.length) {
      for (const t of waiting) { t.status = "blocked"; t.findings = [`Blocked: depends on ${t.dependsOn.filter((d) => S.tasks.find((x) => x.id === d)?.status !== "verified").join(", ")}, which did not pass verification.`]; }
      break;
    }
    for (let i = 0; i < ready.length; i += L.concurrency) await Promise.all(ready.slice(i, i + L.concurrency).map(runTask));
  }

  // Final project-level validation with targeted correction of the smallest affected set.
  progress("validating");
  for (let round = 0; ; round++) {
    const findings: string[] = [];
    const unverified = S.tasks.filter((t) => t.status !== "verified");
    if (unverified.length) findings.push(`Not verified: ${unverified.map((t) => `${t.id} (${t.status})`).join(", ")}.`);
    if (S.tasks.length !== N) findings.push(`Expected ${N} ${noun}s, have ${S.tasks.length}.`);
    if (o.analysis.allowedDurations && o.analysis.totalDuration && !unverified.length) {
      const sum = S.tasks.reduce((x, t) => x + (extractDurations(t.output ?? "")[0] ?? 0), 0);
      if (planDurations(Math.round(o.analysis.totalDuration), o.analysis.allowedDurations, N) && Math.abs(sum - o.analysis.totalDuration) > 0.01) findings.push(`Durations sum to ${sum}s, expected ${o.analysis.totalDuration}s.`);
    }
    if (unverified.length || over()) { S.finalFindings = findings; S.finalValidation = "failed"; break; }
    const r = await call([{ role: "system", content: FINAL_REVIEW }, { role: "user", content: `Original request:\n${clip(o.request, 6000)}\n\nPlan:\n${S.plan.concept}\n${S.plan.shared.map((x) => `- ${x}`).join("\n")}\n\n${S.tasks.map((t) => `=== ${t.id}: ${t.title} ===\n${clip(t.output ?? "", Math.floor(24000 / N))}`).join("\n\n")}` }], true);
    if (!r.ok) { S.finalFindings = [...findings, "The cross-part consistency check could not run."]; S.finalValidation = findings.length ? "failed" : "unverified"; break; }
    const v = parseConflicts(r.text, N);
    log({ stage: "final", round, pass: v.pass && !findings.length, conflicts: v.conflicts.map((c) => c.id) });
    if (v.pass && !findings.length) { S.finalValidation = "passed"; S.finalFindings = []; break; }
    const conflicts = v.pass ? [] : v.conflicts.length ? v.conflicts : [{ id: "", reason: r.text.slice(0, 300) }];
    if (round >= L.maxFinalRounds || !conflicts.every((c) => c.id)) { S.finalFindings = [...findings, ...conflicts.map((c) => `${c.id ? `${c.id}: ` : ""}${c.reason}`)]; S.finalValidation = "failed"; break; }
    if (!conflicts.length) { S.finalFindings = findings; S.finalValidation = "failed"; break; }
    // Correct only the named tasks (and recheck dependents whose input changed).
    const affected = new Set(conflicts.map((c) => c.id));
    for (const t of S.tasks) if (t.dependsOn.some((d) => affected.has(d))) affected.add(t.id);
    for (const id of affected) {
      const t = S.tasks.find((x) => x.id === id)!;
      const reasons = conflicts.filter((c) => c.id === id).map((c) => c.reason);
      t.status = "needs_correction"; t.findings = reasons.length ? reasons.map((x) => `Cross-part conflict: ${x}`) : ["An earlier part it depends on changed; keep it consistent."];
      const others = S.tasks.filter((x) => x.id !== id).map((x) => `${x.id}: ${clip(x.output ?? "", 800)}`).join("\n");
      await correctLoop(t, `Other parts (keep consistent with them):\n${clip(others, 6000)}\n\n`);
    }
    await save();
  }

  // Consolidated output: latest accepted revision of each task, in plan order.
  progress("assembling");
  const ok = S.tasks.every((t) => t.status === "verified") && S.finalValidation === "passed";
  S.overall = ok ? "completed" : S.tasks.some((t) => t.status === "verified") ? "incomplete" : "failed";
  // The user's "no headings" rule also applies to the assembled labels.
  const label = (t: DeepTask) => (o.analysis.instructions?.noHeadings ? "" : `## ${cap(noun)} ${t.index + 1}: ${t.title}\n\n`);
  const parts = S.tasks.map((t) => t.status === "verified" || t.output
    ? `${label(t)}${t.output ?? ""}${t.status !== "verified" ? `\n\n> **Not verified (${t.status}):** ${t.findings.join(" ")}` : ""}`
    : `${label(t)}> **${cap(noun)} ${t.index + 1} not produced (${t.status}):** ${t.findings.join(" ") || "no result"}`);
  let text = parts.join("\n\n");
  if (!ok) {
    const lines = [...S.finalFindings];
    if (S.finalValidation === "unverified") lines.push("All parts passed their individual checks, but the final consistency check could not run.");
    text += `\n\n> **Verification status:** this answer is not fully verified.\n${[...new Set(lines)].map((l) => `> - ${l}`).join("\n")}`;
  } else {
    const unreviewed = S.tasks.filter((t) => !t.reviewed).map((t) => t.id);
    if (unreviewed.length) text += `\n\n> **Verification note:** the independent review could not run for ${unreviewed.join(", ")}; only the automatic checks were applied there.`;
  }
  S.result = text;
  await save();
  log({ stage: "done", executionId: S.executionId, overall: S.overall, final: S.finalValidation, calls, attempts: S.totalAttempts, ms: now() - t0, statuses: S.tasks.map((t) => `${t.id}:${t.status}:r${t.rev}`) });
  return { text, state: S, calls, reused: false };
}

/** Strips bulky revision history before persisting (keeps the latest output and findings only). */
export function compactState(s: ExecutionState): ExecutionState {
  return { ...s, tasks: s.tasks.map((t) => ({ ...t, revisions: t.revisions.map((r) => ({ ...r, output: r.rev === t.rev ? "" : r.output.slice(0, 200) })) })) };
}
