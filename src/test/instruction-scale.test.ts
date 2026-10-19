import { describe, it, expect } from "vitest";
import { analyzeRequest, MAX_ITEMS } from "@/lib/ai/deep/analyze";
import { normalizeSections } from "@/lib/ai/deep/instructions";
import { validateCandidate, ranges } from "@/lib/ai/deep/validators";
import { runDeepPipeline, DEEP_LIMITS, REVIEW_SYSTEM, type CallResult, type ChatMsg } from "@/lib/ai/deep/pipeline";

const req = (n: number) => `Write a story with exactly ${n} scenes, 25-30 words per scene. English scene descriptions, Hindi dialogue in Devanagari. Keep character clothing consistent and no extra commentary.`;
// 22 English description words + 5 Hindi dialogue words = 27 words.
const scene = (n: number) => `Scene ${n}: Riya, wearing her red scarf and blue jacket, walks through the quiet market at dawn, looking for her lost brother near the old fountain. "मैं उसे ज़रूर ढूँढूँगी।"`;
const story = (nums: number[], f: (n: number) => string = scene) => nums.map(f).join("\n\n");
const seq = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const ok = (text: string): CallResult => ({ ok: true, text, finishReason: "stop" });
// Deterministic pseudo-random picks so failures are reproducible.
const picks = (n: number, k: number, seed = 7) => { const out = new Set<number>(); let x = seed; while (out.size < Math.min(k, n)) { x = (x * 1103515245 + 12345) % 2 ** 31; out.add((x % n) + 1); } return [...out].sort((a, b) => a - b); };
const parseNums = (s: string) => s.split(/,\s*/).flatMap((p) => { const [a, b] = p.split("-").map(Number); return b ? seq(b - a + 1).map((i) => i + a - 1) : [a]; });

/** Mock model: answers batch requests and targeted rewrites with valid scenes; `bad` sections are written wrong on first generation. */
function mockModel(opts: { bad?: (n: number) => string | null; skip?: number[]; review?: (body: string) => string } = {}) {
  const calls: string[] = [];
  const seen = new Set<number>();
  const call = async (msgs: ChatMsg[]): Promise<CallResult> => {
    const last = String(msgs[msgs.length - 1].content);
    if (msgs[0].content === REVIEW_SYSTEM) { calls.push("review"); return ok(opts.review ? opts.review(last) : "PASS"); }
    const batch = /Write ONLY Scene (\d+) to Scene (\d+)/.exec(last);
    if (batch) {
      calls.push("batch");
      const nums = seq(Number(batch[2]) - Number(batch[1]) + 1).map((i) => i + Number(batch[1]) - 1).filter((n) => !opts.skip?.includes(n));
      return ok(story(nums, (n) => { const b = !seen.has(n) && opts.bad?.(n); seen.add(n); return b || scene(n); }));
    }
    const fix = /Rewrite ONLY scene ([\d,\s-]+?) to fix/.exec(last);
    if (fix) { calls.push("fix"); return ok(story(parseNums(fix[1]))); }
    calls.push("single");
    return ok("unexpected");
  };
  return { call, calls };
}

const COUNTS = [1, 5, 10, 20, 50, 100, 200, 500, 7, 37, 333];

describe.each(COUNTS)("validation at %i components", (n) => {
  const a = analyzeRequest(req(n));
  it("derives the count from the request", () => expect(a.items).toEqual({ count: n, noun: "scene" }));
  it("accepts a fully valid output", () => expect(validateCandidate(story(seq(n)), a)).toEqual([]));
  it("finds missing components at the beginning, middle and end", () => {
    const gone = [...new Set([1, Math.ceil(n / 2), n])];
    const issue = validateCandidate(story(seq(n).filter((i) => !gone.includes(i))), a).find((i) => i.code === "missing");
    expect(issue?.items).toEqual(gone);
  });
  it("finds word-count violations in randomly selected components", () => {
    const bad = picks(n, 5);
    const w = validateCandidate(story(seq(n), (i) => (bad.includes(i) ? `Scene ${i}: Riya waits. "रुको।"` : scene(i))), a).find((i) => i.code === "word_count");
    expect(w?.items).toEqual(bad);
  });
  it("finds script violations in late components", () => {
    const late = [n];
    const s = validateCandidate(story(seq(n), (i) => (late.includes(i) ? scene(i).replace(/"[^"]+"/, '"Main use zaroor dhoondhungi."') : scene(i))), a).find((i) => i.code === "script");
    expect(s?.items).toEqual(late);
  });
});

describe("structure repair at scale", () => {
  it.each([5, 100, 500])("removes extras and duplicates and restores order for %i", (n) => {
    const a = analyzeRequest(req(n));
    const messy = story([...seq(n).reverse(), 2, n + 1]);
    expect(validateCandidate(messy, a).map((i) => i.code)).toEqual(expect.arrayContaining(["duplicate", "extra", "order"]));
    expect(validateCandidate(normalizeSections(messy, "scene", n), a)).toEqual([]);
  });
  it("compresses long number lists without dropping any", () => expect(ranges([1, 2, 3, 7, 9, 10, 500])).toBe("1-3, 7, 9-10, 500"));
  it("accepts counts up to the resource cap and refuses above it", () => {
    expect(analyzeRequest(req(MAX_ITEMS)).items?.count).toBe(MAX_ITEMS);
    expect(analyzeRequest(req(MAX_ITEMS + 1)).items).toBeNull();
  });
});

describe("batched generation", () => {
  it.each([50, 100, 500])("generates %i scenes in batches and validates every one", async (n) => {
    const m = mockModel();
    const r = await runDeepPipeline({ messages: [{ role: "user", content: req(n) }], analysis: analyzeRequest(req(n)), call: m.call });
    expect(r.ok && r.remaining).toEqual([]);
    expect(r.ok && validateCandidate(r.text, analyzeRequest(req(n)))).toEqual([]);
    expect(m.calls.filter((c) => c === "batch")).toHaveLength(Math.ceil(n / DEEP_LIMITS.batchItems));
  });
  it("fills components a batch skipped and fixes violations spanning batches, touching only those", async () => {
    const n = 100, bad = [19, 20, 21, 41, 99];
    const m = mockModel({ skip: [60], bad: (i) => (bad.includes(i) ? `Scene ${i}: Riya waits. "रुको।"` : null) });
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(n)), call: m.call });
    expect(r.ok && r.remaining).toEqual([]);
    expect(r.ok && r.corrections).toBe(1);
    expect(m.calls.filter((c) => c === "fix")).toHaveLength(1); // 6 targets fit in one correction batch
  });
  it("catches a cross-batch consistency failure in a later review window and corrects that scene", async () => {
    const n = 200;
    let flagged = false;
    const m = mockModel({ review: (body) => (!flagged && /Scene 173:/.test(body) ? ((flagged = true), "ISSUES:\n- Scene 173: Riya's scarf changes colour.") : "PASS") });
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(n)), call: m.call, review: true, request: req(n) });
    expect(m.calls.filter((c) => c === "review").length).toBeGreaterThan(1);
    expect(r.ok && r.stages).toContain("correct-sections");
    expect(r.ok && r.remaining).toEqual([]);
  });
  it("discloses review coverage gaps instead of claiming full review", async () => {
    const n = 500;
    const m = mockModel();
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(n)), call: m.call, review: true, request: req(n), limits: { maxReviewWindows: 2 } });
    expect(r.ok && r.text).toMatch(/review covered 2 of \d+ parts/);
  });
  it("stops at the time limit and offers a continuation for unwritten scenes", async () => {
    let t = 0;
    const m = mockModel();
    const timed = async (msgs: ChatMsg[]) => { t += 100_000; return m.call(msgs); };
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(200)), call: timed, now: () => t });
    expect(r.ok && r.remaining.find((i) => i.code === "missing")?.items?.length).toBeGreaterThan(0);
    expect(r.ok && r.text).toMatch(/continue with scenes \d+-200/);
  });
  it("enforces the retry limit when corrections keep failing", async () => {
    const n = 500;
    const m = mockModel({ bad: () => `Scene 0: x` });
    const broken = async (msgs: ChatMsg[]) => (/Rewrite ONLY/.test(String(msgs.at(-1)!.content)) ? ok("nothing usable") : m.call(msgs));
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(n)), call: broken });
    expect(r.ok && r.corrections).toBe(DEEP_LIMITS.maxCorrections);
    expect(r.ok && r.text).toMatch(/still not met/);
  });
});

describe("live 25-scene run: output cap and time budget", () => {
  it("writes 25 scenes in batches small enough for one call, running later batches in parallel", async () => {
    const m = mockModel();
    let live = 0, peak = 0, maxBatch = 0;
    const call = async (msgs: ChatMsg[]) => {
      const b = /Write ONLY Scene (\d+) to Scene (\d+)/.exec(String(msgs.at(-1)!.content));
      if (b) maxBatch = Math.max(maxBatch, Number(b[2]) - Number(b[1]) + 1);
      live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--;
      return m.call(msgs);
    };
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(25)), call });
    expect(r.ok && r.remaining).toEqual([]);
    expect(maxBatch).toBeLessThanOrEqual(DEEP_LIMITS.batchItems);
    expect(peak).toBeGreaterThan(1);
  });
});
describe("live 25-scene run: parallel parts share one outline", () => {
  it("asks the hidden plan for a per-scene state outline and tells every part to follow it", async () => {
    const m = mockModel(); const sent: string[] = [];
    const call = async (msgs: ChatMsg[]) => { sent.push(msgs.map((x) => String(x.content)).join("\n")); return /numbered outline/.test(String(msgs[0].content)) ? ok(seq(25).map((n) => `${n}. Bolt event ${n}, core held by Bolt`).join("\n")) : m.call(msgs); };
    await runDeepPipeline({ messages: [{ role: "system", content: "sys" }], analysis: analyzeRequest(req(25)), call, plan: true, request: req(25) });
    expect(sent[0]).toMatch(/one line per scene \(1 to 25\)/);
    expect(sent.filter((x) => /Follow the internal plan's outline lines for Scene 5 to 10/.test(x))).toHaveLength(1);
  });
  it("retries a failed parallel part once instead of leaving it missing (seen live: scenes 21-24)", async () => {
    const m = mockModel(); let failed = false;
    const call = async (msgs: ChatMsg[]) => { if (!failed && /Write ONLY Scene 16 to Scene 20/.test(String(msgs.at(-1)!.content))) { failed = true; return { ok: false as const, status: 504, reason: "timeout" }; } return m.call(msgs); };
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest(req(25)), call });
    expect(r.ok && r.remaining).toEqual([]);
  });
});
