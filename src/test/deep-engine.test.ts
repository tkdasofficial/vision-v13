import { describe, it, expect } from "vitest";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { runDeepEngine, shouldDecompose, buildTaskContext, buildTasks, callWithRetry, ENGINE_LIMITS, type ExecutionState, type StateStore } from "@/lib/ai/deep/engine";
import { checkTables, checkCode, validateCandidate } from "@/lib/ai/deep/validators";
import { collectStream, sseStatus, sseChunk } from "@/lib/ai/deep/sse";
import type { CallResult, ChatMsg } from "@/lib/ai/deep/pipeline";

const ok = (text: string, finishReason: string | null = "stop"): CallResult => ({ ok: true, text, finishReason });
const sys = (m: ChatMsg[]) => String(m[0].content);
const usr = (m: ChatMsg[]) => String(m[m.length - 1].content);
const taskNo = (m: ChatMsg[]) => Number(/part (\d+) of/.exec(usr(m))?.[1]);
const plan = (n: number, deps: Record<number, number[]> = {}) => JSON.stringify({ concept: "A fox's journey", shared: ["The fox is red with a white tail"], tasks: Array.from({ length: n }, (_, i) => ({ title: `Shot ${i + 1}`, spec: `Visual ${i + 1}`, criteria: ["mentions the fox"], dependsOn: deps[i + 1] ?? [] })) });
const memStore = (): StateStore & { data: Map<string, ExecutionState> } => {
  const data = new Map<string, ExecutionState>();
  return { data, load: async (id) => (data.has(id) ? structuredClone(data.get(id)!) : null), save: async (s) => { data.set(s.requestId, structuredClone(s)); } };
};

/** Scriptable fake model: routes by stage (plan / task generation / task review / final review / correction). */
function fakeModel(o: { gen?: (n: number, m: ChatMsg[]) => CallResult; review?: (n: number, m: ChatMsg[]) => string; final?: (round: number) => string; plan?: string } = {}) {
  const log: { kind: string; task?: number }[] = [];
  let finalRound = 0;
  const call = async (m: ChatMsg[]): Promise<CallResult> => {
    const s = sys(m);
    if (s.includes("planning stage")) { log.push({ kind: "plan" }); return ok(o.plan ?? plan(6)); }
    if (s.includes("final validator")) { log.push({ kind: "final" }); return ok(o.final ? o.final(finalRound++) : "PASS"); }
    if (s.includes("independent verifier")) { const n = Number(/Task T(\d+)/.exec(usr(m))?.[1]); log.push({ kind: "review", task: n }); return ok(o.review ? o.review(n, m) : "PASS"); }
    const n = taskNo(m);
    const kind = usr(m).includes("Verification found these problems") ? "correct" : "gen";
    log.push({ kind, task: n });
    return o.gen ? o.gen(n, m) : ok(`The red fox, visual ${n}.`);
  };
  return { call, log };
}

const req = "Write 6 visual prompts for a story about a fox";
const base = (extra: Partial<Parameters<typeof runDeepEngine>[0]> & { call: Parameters<typeof runDeepEngine>[0]["call"] }) => ({ request: req, requestId: "req-00000001", analysis: analyzeRequest(req), baseSystem: "BASE", sleep: async () => {}, ...extra });

describe("Deep Thinking execution engine", () => {
  it("decomposes only multi-deliverable requests (simple questions skip it)", () => {
    expect(shouldDecompose(analyzeRequest(req))).toBe(true);
    expect(shouldDecompose(analyzeRequest("What is 2+2?"))).toBe(false);
  });

  it("A: six deliverables → six distinct generation requests, each tied to its task", async () => {
    const f = fakeModel();
    const r = await runDeepEngine(base({ call: f.call }));
    const gens = f.log.filter((l) => l.kind === "gen").map((l) => l.task).sort();
    expect(gens).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.state.tasks.map((t) => t.output)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `The red fox, visual ${n}.`));
    expect(r.state.overall).toBe("completed");
    expect(r.state.tasks.every((t) => t.status === "verified")).toBe(true);
    expect(r.text.indexOf("Prompt 1:")).toBeLessThan(r.text.indexOf("Prompt 6:"));
    expect(r.text).not.toMatch(/not fully verified/);
  });

  it("B: only the failing task (3) is corrected; others are not regenerated", async () => {
    let first = true;
    const f = fakeModel({ review: (n) => (n === 3 && first ? ((first = false), "ISSUES:\n- does not mention the fox") : "PASS") });
    const r = await runDeepEngine(base({ call: f.call }));
    expect(f.log.filter((l) => l.kind === "correct").map((l) => l.task)).toEqual([3]);
    expect(f.log.filter((l) => l.kind === "gen").length).toBe(6);
    expect(r.state.tasks[2].revisions.length).toBe(2);
    expect(r.state.overall).toBe("completed");
  });

  it("C: final validator catches a cross-task conflict and corrects only the named task", async () => {
    const f = fakeModel({ final: (round) => (round === 0 ? "CONFLICT T5: the fox is grey here but red elsewhere" : "PASS") });
    const r = await runDeepEngine(base({ call: f.call }));
    expect(f.log.filter((l) => l.kind === "correct").map((l) => l.task)).toEqual([5]);
    expect(r.state.finalValidation).toBe("passed");
    expect(r.state.overall).toBe("completed");
  });

  it("D: repeated failure terminates within limits and never claims success", async () => {
    const f = fakeModel({ review: (n) => (n === 2 ? "ISSUES:\n- wrong" : "PASS") });
    const r = await runDeepEngine(base({ call: f.call }));
    expect(f.log.filter((l) => l.kind === "correct" && l.task === 2).length).toBe(ENGINE_LIMITS.maxCorrectionsPerTask);
    expect(r.state.tasks[1].status).toBe("failed");
    expect(r.state.overall).not.toBe("completed");
    expect(r.text).toMatch(/not fully verified/);
    expect(f.log.some((l) => l.kind === "final")).toBe(false);
  });

  it("E: rate limits, timeouts and malformed replies are retried with backoff; permanent errors are not", async () => {
    const waits: number[] = [];
    const seq: CallResult[] = [{ ok: false, status: 429, reason: "rl" }, { ok: false, status: 504, reason: "timeout" }, ok("")];
    let i = 0;
    const r = await callWithRetry(async () => seq[i++] ?? ok("fine"), [], { ...ENGINE_LIMITS, maxRetries: 3 }, async (ms) => { waits.push(ms); });
    expect(r.ok && r.text).toBe("fine");
    expect(waits).toEqual([800, 1600, 3200]);
    let n = 0;
    const p = await callWithRetry(async () => { n++; return { ok: false, status: 400, reason: "bad" }; }, [], ENGINE_LIMITS, async () => {});
    expect(p.ok).toBe(false); expect(n).toBe(1);
    // A transient failure on one task recovers inside the engine.
    let failed = false;
    const f = fakeModel({ gen: (k) => (k === 4 && !failed ? ((failed = true), { ok: false, status: 503, reason: "down" }) : ok(`The red fox, visual ${k}.`)) });
    const res = await runDeepEngine(base({ call: f.call }));
    expect(res.state.overall).toBe("completed");
  });

  it("F: oversized tasks are blocked instead of silently dropping requirements; optional context is shortened", () => {
    const a = analyzeRequest(req);
    const { tasks, plan: p } = buildTasks(JSON.parse(plan(6)), a);
    const s = { tasks, plan: { ...p, concept: "x".repeat(50_000) }, limits: ENGINE_LIMITS } as unknown as ExecutionState;
    const ctx = buildTaskContext(s, tasks[0], req);
    expect("text" in ctx && ctx.text).toContain(req);
    expect("text" in ctx && ctx.text).toContain("Acceptance criteria");
    expect("text" in ctx && ctx.text.length).toBeLessThanOrEqual(ENGINE_LIMITS.contextCharBudget + 50);
    const huge = buildTaskContext(s, tasks[0], "y".repeat(40_000));
    expect("blocked" in huge).toBe(true);
  });

  it("G: an interrupted execution resumes without redoing verified tasks or losing results", async () => {
    const store = memStore();
    let crash = true;
    const f1 = fakeModel({ gen: (k) => { if (k === 5 && crash) throw new Error("worker died"); return ok(`The red fox, visual ${k}.`); } });
    await runDeepEngine(base({ call: f1.call, store, limits: { maxRetries: 0, maxCorrectionsPerTask: 0 } }));
    const saved = store.data.get("req-00000001")!;
    expect(saved.tasks.filter((t) => t.status === "verified").length).toBe(5);
    crash = false;
    const f2 = fakeModel();
    const r = await runDeepEngine(base({ call: f2.call, store }));
    expect(f2.log.filter((l) => l.kind === "gen").map((l) => l.task)).toEqual([5]);
    expect(f2.log.some((l) => l.kind === "plan")).toBe(false);
    expect(r.state.overall).toBe("completed");
  });

  it("H: progress events arrive in pipeline order and before the final text", async () => {
    const events: string[] = [];
    const f = fakeModel();
    await runDeepEngine(base({ call: f.call, progress: (s) => events.push(s), limits: { concurrency: 1 } }));
    const firstOf = (s: string) => events.indexOf(s);
    expect(firstOf("analyzing")).toBe(0);
    expect(firstOf("planning")).toBeLessThan(firstOf("generating"));
    expect(firstOf("generating")).toBeLessThan(firstOf("verifying"));
    expect(firstOf("verifying")).toBeLessThan(firstOf("validating"));
    expect(events[events.length - 1]).toBe("assembling");
    // Status events are invisible to the text parser and keep order with content.
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) { c.enqueue(sseStatus("verifying", "Prompt 2")); c.enqueue(sseChunk("Final")); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
    expect((await collectStream(body)).text).toBe("Final");
  });

  it("I: a repeated request returns the stored result without new tasks or model calls", async () => {
    const store = memStore();
    const f = fakeModel();
    const a = await runDeepEngine(base({ call: f.call, store }));
    const before = f.log.length;
    const b = await runDeepEngine(base({ call: f.call, store }));
    expect(b.reused).toBe(true);
    expect(f.log.length).toBe(before);
    expect(b.text).toBe(a.text);
  });

  it("dependencies: dependent tasks wait and receive the dependency output", async () => {
    const seen: string[] = [];
    const f = fakeModel({ plan: plan(6, { 2: [1] }), gen: (k, m) => { if (k === 2) seen.push(usr(m)); return ok(`The red fox, visual ${k}.`); } });
    const r = await runDeepEngine(base({ call: f.call }));
    expect(seen[0]).toContain("Output of T1");
    expect(r.state.overall).toBe("completed");
    // Blocked when the dependency fails.
    const g = fakeModel({ plan: plan(6, { 2: [1] }), review: (n) => (n === 1 ? "ISSUES:\n- bad" : "PASS") });
    const r2 = await runDeepEngine(base({ call: g.call, requestId: "req-00000002" }));
    expect(r2.state.tasks[1].status).toBe("blocked");
    expect(r2.state.overall).not.toBe("completed");
  });

  it("durations: each scene gets a planned length and the total is validated", async () => {
    const q = "Make 6 scenes for a 36 second audio. The generator supports 4, 6, 8, or 10 second clips.";
    const f = fakeModel({ gen: (k, m) => ok(`The red fox. Duration: ${k === 6 ? 7 : /exactly as "Duration: (\d+)s"/.exec(usr(m))![1]}s`) });
    const r = await runDeepEngine({ ...base({ call: f.call }), request: q, analysis: analyzeRequest(q) });
    expect(r.state.tasks.reduce((x, t) => x + (t.requiredDuration ?? 0), 0)).toBe(36);
    expect(r.state.tasks.slice(0, 5).every((t) => t.status === "verified")).toBe(true);
    expect(r.state.tasks[5].status).toBe("failed");
    expect(r.state.overall).not.toBe("completed");
  });

  it("J: code checks catch broken JSON, unbalanced code and unclosed HTML; valid code passes", () => {
    expect(checkCode("```json\n{\"a\":1,}\n```")[0].code).toBe("code_json");
    expect(checkCode("```js\nfunction f() { return [1, 2;\n```")[0].code).toBe("code_brackets");
    expect(checkCode("```html\n<html><body>hi</body>\n```")[0].code).toBe("code_html");
    expect(checkCode("```ts\nconst s = \"{\"; // }\nfunction f(a: number[]) { return a.map((x) => x * 2); }\n```")).toEqual([]);
    expect(checkCode("```python\ndef f(:\n```")).toEqual([]); // not statically checked — never falsely claimed
  });

  it("K: table checks catch missing cells, wrong totals and duplicate rows", () => {
    const good = "| Item | Qty |\n|---|---:|\n| A | 2 |\n| B | 3 |\n| **Total** | **5** |";
    expect(checkTables(good)).toEqual([]);
    expect(checkTables("| Item | Qty |\n|---|---|\n| A |\n| B | 3 |")[0].code).toBe("table_columns");
    expect(checkTables(good.replace("**5**", "**6**"))[0].code).toBe("table_total");
    expect(checkTables("| A | B |\n|---|---|\n| x | 1 |\n| x | 1 |")[0].code).toBe("table_duplicate");
    expect(validateCandidate(good, analyzeRequest("make a table"))).toEqual([]);
  });

  it("L: simple requests keep the single-answer path", () => {
    expect(shouldDecompose(analyzeRequest("Explain recursion in detail"))).toBe(false);
    expect(shouldDecompose(analyzeRequest("Return 3 items as JSON"))).toBe(false);
  });
});
