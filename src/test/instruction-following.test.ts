import { describe, it, expect, vi } from "vitest";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { countWords, parseInstructions, checkInstructions, spliceSections } from "@/lib/ai/deep/instructions";
import { validateCandidate } from "@/lib/ai/deep/validators";
import { runDeepPipeline, type CallResult } from "@/lib/ai/deep/pipeline";

const REQ = "Write a story with exactly 10 scenes, 25-30 words per scene. English scene descriptions, Hindi dialogue in Devanagari. Keep character appearances and clothing consistent, continuous storytelling, and no extra commentary.";
const ok = (text: string): CallResult => ({ ok: true, text, finishReason: "stop" });
// 22 English description words + 5 Hindi dialogue words = 27 words.
const scene = (n: number) => `Scene ${n}: Riya, wearing her red scarf and blue jacket, walks through the quiet market at dawn, looking for her lost brother near the old fountain. "मैं उसे ज़रूर ढूँढूँगी।"`;
const story = (fix?: (n: number) => string) => Array.from({ length: 10 }, (_, i) => (fix ?? scene)(i + 1)).join("\n\n");

describe("instruction parser", () => {
  it("extracts every explicit requirement from the acceptance request", () => {
    const a = analyzeRequest(REQ);
    expect(a.items).toEqual({ count: 10, noun: "scene" });
    expect(a.instructions?.words).toEqual({ min: 25, max: 30, per: "item" });
    expect(a.instructions?.scripts).toEqual(expect.arrayContaining([
      { part: "dialogue", script: "devanagari", language: "hindi" },
      { part: "description", script: "latin", language: "english" },
    ]));
    expect(a.instructions?.noCommentary).toBe(true);
    expect(a.instructions?.consistency).toBe(true);
    expect(a.complex).toBe(true);
  });
  it("does not invent requirements for simple questions", () => {
    const a = analyzeRequest("What is the capital of France?");
    expect(a.instructions).toBeUndefined();
    expect(a.complex).toBe(false);
  });
  it("reads total word limits", () => {
    expect(parseInstructions("Explain it in under 100 words").words).toEqual({ min: null, max: 100, per: "total" });
  });
});

describe("word counting rule", () => {
  it("counts tokens with a letter or digit in any script, ignoring markdown and dashes", () => {
    expect(countWords("**Hello** — world 42 मैं ठीक हूँ")).toBe(6);
  });
});

describe("validation of the acceptance scenario", () => {
  const a = analyzeRequest(REQ);
  it("valid story passes all hard constraints", () => expect(validateCandidate(story(), a)).toEqual([]));
  it("detects missing and extra scenes", () => {
    expect(validateCandidate(story().split("\n\n").slice(0, 9).join("\n\n"), a).map((i) => i.code)).toContain("missing");
    expect(validateCandidate(story() + "\n\n" + scene(11), a).map((i) => i.code)).toContain("extra");
  });
  it("flags word-count violations on the exact scene", () => {
    const issues = validateCandidate(story((n) => (n === 4 ? `Scene 4: Riya runs. "चलो।"` : scene(n))), a);
    const w = issues.find((i) => i.code === "word_count");
    expect(w?.items).toEqual([4]);
  });
  it("flags romanized Hindi dialogue and Hindi descriptions", () => {
    const roman = story((n) => (n === 2 ? scene(2).replace(/"[^"]+"/, '"Main use zaroor dhoondhungi."') : scene(n)));
    expect(validateCandidate(roman, a).find((i) => i.code === "script")?.items).toEqual([2]);
    const hindiDesc = story((n) => (n === 7 ? `Scene 7: रिया लाल दुपट्टा पहनकर बाज़ार में अपने भाई को ढूँढती है और फव्वारे के पास रुकती है फिर आगे बढ़ती है धीरे धीरे सुबह। "मैं उसे ढूँढूँगी।"` : scene(n)));
    expect(validateCandidate(hindiDesc, a).some((i) => i.code === "script" && i.items?.includes(7))).toBe(true);
  });
  it("flags extra commentary", () => {
    expect(validateCandidate("Sure! Here is your story:\n\n" + story(), a).map((i) => i.code)).toContain("commentary");
    expect(validateCandidate(story() + "\n\nI hope you enjoy this story!", a).map((i) => i.code)).toContain("commentary");
  });
});

describe("targeted correction", () => {
  const a = analyzeRequest(REQ);
  it("splices only the affected section", () => {
    const bad = story((n) => (n === 3 ? "Scene 3: Too short." : scene(n)));
    const out = spliceSections(bad, scene(3), "scene", [3])!;
    expect(out).toBe(story());
  });
  it("rewrites only the failed scene, then revalidates the whole story", async () => {
    const bad = story((n) => (n === 5 ? `Scene 5: Riya waits. "रुको।"` : scene(n)));
    const call = vi.fn().mockResolvedValueOnce(ok(bad)).mockResolvedValueOnce(ok(scene(5)));
    const r = await runDeepPipeline({ messages: [{ role: "user", content: REQ }], analysis: a, call });
    expect(r.ok && r.text).toBe(story());
    expect(r.ok && r.stages).toEqual(["generate", "validate", "plot-check", "correct", "correct-sections", "revalidate"]);
    expect(String(call.mock.calls[1][0].at(-1).content)).toMatch(/ONLY scene 5/);
  });
  it("stops after the retry limit and discloses unmet requirements", async () => {
    const bad = story((n) => (n === 5 ? `Scene 5: Riya waits. "रुको।"` : scene(n)));
    const call = vi.fn().mockResolvedValueOnce(ok(bad)).mockResolvedValue(ok(`Scene 5: still short. "रुको।"`));
    const r = await runDeepPipeline({ messages: [], analysis: a, call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(r.ok && r.remaining.map((i) => i.code)).toContain("word_count");
    expect(r.ok && r.text).toMatch(/still not met/);
  });
  it("falls back to a full correction when the section patch is unusable", async () => {
    const bad = story((n) => (n === 5 ? `Scene 5: Riya waits. "रुको।"` : scene(n)));
    const call = vi.fn().mockResolvedValueOnce(ok(bad)).mockResolvedValueOnce(ok("garbage")).mockResolvedValueOnce(ok(story()));
    const r = await runDeepPipeline({ messages: [], analysis: a, call });
    expect(r.ok && r.text).toBe(story());
  });
  it("adds a continuity check to the reviewer without claiming it as a hard check", async () => {
    const call = vi.fn().mockResolvedValueOnce(ok(story())).mockResolvedValueOnce(ok("PASS"));
    const r = await runDeepPipeline({ messages: [], analysis: a, call, review: true, request: REQ });
    expect(String(call.mock.calls[1][0][1].content)).toMatch(/continuity/);
    expect(r.ok && r.text).toBe(story());
  });
});

describe("checkInstructions without numbered items", () => {
  it("checks total limits on plain answers", () => {
    expect(checkInstructions("one two three four", parseInstructions("answer in at most 3 words"), null)[0].code).toBe("word_count");
  });
});
