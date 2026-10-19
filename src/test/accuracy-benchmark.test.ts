// Universal output-accuracy benchmark: deterministic, repeatable checks of analysis → validation → correction
// across task categories, with simulated models (correct, flawed, and a primary that never passes).
import { describe, it, expect } from "vitest";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { validateCandidate } from "@/lib/ai/deep/validators";
import { runDeepPipeline, type CallResult } from "@/lib/ai/deep/pipeline";

const ok = (text: string): CallResult => ({ ok: true, text, finishReason: "stop" });
const list = (noun: string, nums: number[], body = (n: number) => `item text ${n}`) => nums.map((n) => `${noun} ${n}: ${body(n)}`).join("\n\n");
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

type Case = { name: string; prompt: string; good: string; bad: string };
const CASES: Case[] = [
  { name: "prompt engineering", prompt: "Write 8 prompts for product photos.", good: list("Prompt", range(8)), bad: list("Prompt", range(7)) },
  { name: "story scenes", prompt: "Write a story in 12 scenes.", good: list("Scene", range(12)), bad: list("Scene", [1, 2, 3, 5, 4, 6, 7, 8, 9, 10, 11, 12]) },
  { name: "structured data", prompt: "Return the result as JSON with name and age.", good: '```json\n{"name":"A","age":3}\n```', bad: '```json\n{"name":"A",age:}\n```' },
  { name: "long document", prompt: "Write 30 sections of a detailed handbook.", good: list("Section", range(30)), bad: list("Section", [...range(29), 29]) },
  { name: "reasoning steps", prompt: "Explain in 5 steps how to solve it.", good: list("Step", range(5)), bad: list("Step", [1, 2, 3]) },
  { name: "large output (500 items)", prompt: "Generate 500 names for products.", good: list("Name", range(500)), bad: list("Name", range(500).filter((n) => n !== 250)) },
  { name: "huge output (1000 items)", prompt: "Write 1000 ideas for startups.", good: list("Idea", range(1000)), bad: list("Idea", range(999)) },
];

describe("accuracy benchmark — deterministic validation per category", () => {
  for (const c of CASES) {
    it(`${c.name}: accepts the correct output and rejects the flawed one`, () => {
      const a = analyzeRequest(c.prompt);
      expect(a.complex).toBe(true);
      expect(validateCandidate(c.good, a)).toEqual([]);
      expect(validateCandidate(c.bad, a).length).toBeGreaterThan(0);
    });
  }

  it("long prompts keep requirements found anywhere in thousands of lines", () => {
    const filler = Array.from({ length: 3000 }, (_, i) => `context line ${i}`).join("\n");
    const a = analyzeRequest(`Write 6 scenes.\n${filler}`);
    expect(a.items).toEqual({ count: 6, noun: "scene" });
  });
});

describe("accuracy benchmark — correction loop and fallback model", () => {
  it("fixes a flawed draft and returns it without a failure note", async () => {
    const a = analyzeRequest("Write 6 scenes.");
    let n = 0;
    const r = await runDeepPipeline({ messages: [{ role: "user", content: "Write 6 scenes." }], analysis: a, call: async () => ok(n++ === 0 ? list("Scene", range(5)) : list("Scene", range(6))) });
    expect(r.ok && r.remaining).toEqual([]);
    expect(r.ok && r.text).not.toMatch(/Verification note/);
  });

  it("switches to the fallback model when the primary keeps failing validation", async () => {
    const a = analyzeRequest("Write 6 scenes.");
    let fallbackUsed = 0;
    const r = await runDeepPipeline({
      messages: [{ role: "user", content: "Write 6 scenes." }], analysis: a,
      call: async () => ok(list("Scene", range(4))),
      fallbackCall: async () => { fallbackUsed++; return ok(list("Scene", range(6))); },
    });
    expect(fallbackUsed).toBeGreaterThan(0);
    expect(r.ok && r.stages).toContain("fallback-model");
    expect(r.ok && r.remaining).toEqual([]);
  });

  it("never claims success when every model fails validation", async () => {
    const a = analyzeRequest("Write 6 scenes.");
    const bad = async () => ok(list("Scene", range(3)));
    const r = await runDeepPipeline({ messages: [{ role: "user", content: "Write 6 scenes." }], analysis: a, call: bad, fallbackCall: bad });
    expect(r.ok && r.remaining.length).toBeGreaterThan(0);
    expect(r.ok && r.text).toMatch(/Verification note/);
  });
});
