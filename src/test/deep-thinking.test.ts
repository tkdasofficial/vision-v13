import { describe, it, expect, vi } from "vitest";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { planDurations, nearestFeasible } from "@/lib/ai/deep/durations";
import { checkSequence, extractItemNumbers, validateCandidate, checkJson } from "@/lib/ai/deep/validators";
import { runDeepPipeline, planAddendum, type CallResult } from "@/lib/ai/deep/pipeline";
import { collectStream } from "@/lib/ai/deep/sse";
import { classifyTask } from "@/lib/ai/task-router";

const ok = (text: string, finishReason: string | null = "stop"): CallResult => ({ ok: true, text, finishReason });
const scenes = (order: number[]) => order.map((n) => `Scene ${n}: a shot. Duration: 6s`).join("\n");

describe("Deep Thinking Mode", () => {
  it("A: simple question is not complex and skips extra stages", () => {
    const a = analyzeRequest("What is the capital of France?");
    expect(a.complex).toBe(false);
    expect(planAddendum(a)).toBe("");
  });

  it("B: detailed technical request is flagged for verification with detail instruction", () => {
    const a = analyzeRequest("Give a detailed explanation of how transformers use attention.");
    expect(a.length).toBe("detailed");
    expect(a.complex).toBe(true);
    expect(planAddendum(a)).toMatch(/thorough/);
  });

  it("C: every requested output must be present", () => {
    const a = analyzeRequest("Write 5 prompts for product photos");
    expect(a.items).toEqual({ count: 5, noun: "prompt" });
    const issues = validateCandidate("Prompt 1: a\nPrompt 2: b\nPrompt 3: c\nPrompt 4: d", a);
    expect(issues.map((i) => i.code)).toContain("missing");
    expect(validateCandidate("Prompt 1: a\nPrompt 2: b\nPrompt 3: c\nPrompt 4: d\nPrompt 5: e", a)).toEqual([]);
  });

  it("D: six scenes stay in order; missing, duplicate and reordered scenes are detected", () => {
    expect(checkSequence([1, 2, 3, 4, 5, 6], 6)).toEqual([]);
    expect(checkSequence([1, 2, 6, 3, 4, 5], 6).map((i) => i.code)).toEqual(["order"]);
    expect(checkSequence([1, 2, 2, 4, 5, 6], 6).map((i) => i.code).sort()).toEqual(["duplicate", "missing"]);
    expect(extractItemNumbers("## Scene 1\nx\n## Scene 2\ny", "scene")).toEqual([1, 2]);
  });

  it("E: unsupported durations, wrong totals and impossible timelines are reported", () => {
    const a = analyzeRequest("Make 6 scenes for a 36 second audio. The generator supports 4, 6, 8, or 10 second clips.");
    expect(a.allowedDurations).toEqual([4, 6, 8, 10]);
    expect(a.totalDuration).toBe(36);
    expect(planDurations(36, [4, 6, 8, 10], 6)?.reduce((x, y) => x + y, 0)).toBe(36);
    expect(planDurations(37, [4, 6, 8, 10])).toBeNull();
    expect(nearestFeasible(37, [4, 6, 8, 10])).toEqual({ below: 36, above: 38 });
    expect(validateCandidate(scenes([1, 2, 3, 4, 5, 6]), a)).toEqual([]);
    const bad = scenes([1, 2, 3, 4, 5]) + "\nScene 6: x. Duration: 5s";
    expect(validateCandidate(bad, a).map((i) => i.code)).toEqual(expect.arrayContaining(["duration_unsupported", "duration_total"]));
    const imp = analyzeRequest("Plan scenes for 37 seconds audio using 4, 6, 8 or 10 second clips");
    expect(planAddendum(imp)).toMatch(/impossible/);
    expect(validateCandidate("Scene 1 Duration: 10s", imp).map((i) => i.code)).toContain("duration_conflict_hidden");
  });

  it("F: invalid candidate is corrected and re-checked", async () => {
    const a = analyzeRequest("Write 3 ideas");
    const call = vi.fn().mockResolvedValueOnce(ok("1. a\n2. b")).mockResolvedValueOnce(ok("1. a\n2. b\n3. c"));
    const r = await runDeepPipeline({ messages: [{ role: "user", content: "Write 3 ideas" }], analysis: a, call });
    expect(r.ok && r.text).toBe("1. a\n2. b\n3. c");
    expect(r.ok && r.corrections).toBe(1);
    expect(r.stages).toEqual(["generate", "validate", "correct", "revalidate"]);
  });

  it("G: long outputs are continued, not silently truncated", async () => {
    const a = analyzeRequest("List 4 steps");
    const call = vi.fn().mockResolvedValueOnce(ok("1. a\n2. b\n", "length")).mockResolvedValueOnce(ok("3. c\n4. d"));
    const r = await runDeepPipeline({ messages: [], analysis: a, call });
    expect(r.ok && r.text).toBe("1. a\n2. b\n3. c\n4. d");
    expect(r.ok && r.remaining).toEqual([]);
  });

  it("H: a failed model call is reported as a failure", async () => {
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest("Write 3 ideas"), call: async () => ({ ok: false, status: 503, reason: "down" }) });
    expect(r.ok).toBe(false);
  });

  it("I/J: unresolved issues are disclosed instead of claimed fixed", async () => {
    const call = vi.fn().mockResolvedValue(ok("1. a"));
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest("Write 3 ideas"), call });
    expect(r.ok && r.text).toMatch(/Verification note/);
    expect(r.ok && r.remaining.length).toBeGreaterThan(0);
  });

  it("K: correction loop is bounded and respects the time budget", async () => {
    const call = vi.fn().mockResolvedValue(ok("1. a"));
    await runDeepPipeline({ messages: [], analysis: analyzeRequest("Write 3 ideas"), call });
    expect(call).toHaveBeenCalledTimes(3); // 1 generate + max 2 corrections
    let t = 0;
    const call2 = vi.fn(async () => { t += 700_000; return ok("1. a", "length"); });
    await runDeepPipeline({ messages: [], analysis: analyzeRequest("Write 3 ideas"), call: call2, now: () => t });
    expect(call2).toHaveBeenCalledTimes(1);
  });

  it("JSON requirement is validated", () => {
    expect(checkJson('```json\n{"a":1}\n```')).toEqual([]);
    expect(checkJson('```json\n{"a":1,}\n```')[0].code).toBe("json_invalid");
  });

  it("collects OpenAI-style streams with finish reason", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
      c.close();
    } });
    expect(await collectStream(body)).toEqual({ text: "Hello", finishReason: "length" });
  });

  it("L: normal chat routing is unchanged", () => {
    expect(classifyTask({ text: "hi", mode: "default", hasMedia: false }).executionMode).toBe("default");
    expect(classifyTask({ text: "hi", mode: "deep", hasMedia: false }).executionMode).toBe("deep");
  });
});
