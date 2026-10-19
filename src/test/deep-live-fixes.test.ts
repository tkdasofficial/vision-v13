import { describe, it, expect } from "vitest";
import { parseInstructions, checkInstructions } from "@/lib/ai/deep/instructions";
import { asksForSources } from "@/lib/ai/request-route";

describe("Deep Thinking live-test regressions", () => {
  it("'no headings' is parsed and a heading in the answer is flagged", () => {
    const ins = parseInstructions("exactly 3 paragraphs; no headings, no bullet lists");
    expect(ins.noHeadings).toBe(true);
    expect(checkInstructions("## Paragraph 1\n\nText.", ins, null).map((i) => i.code)).toContain("headings");
    expect(checkInstructions("Text only.\n\nMore text.", ins, null).map((i) => i.code)).not.toContain("headings");
  });
  it("asking for sources triggers a real search, source code does not", () => {
    expect(asksForSources("Who won the 2018 World Cup? Cite sources.")).toBe(true);
    expect(asksForSources("Explain photosynthesis with sources")).toBe(true);
    expect(asksForSources("Show me the source code for a todo app")).toBe(false);
  });
});

import { shouldDecompose } from "@/lib/ai/deep/engine";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
describe("Deep engine decomposition", () => {
  it("paragraphs of one text are written together, separate deliverables still split", () => {
    expect(shouldDecompose(analyzeRequest("Write a product description in exactly 3 paragraphs, each 40-60 words."))).toBe(false);
    expect(shouldDecompose(analyzeRequest("Write 6 visual prompts for a story about a fox"))).toBe(true);
  });
});

describe("unlabelled paragraph word counts", () => {
  it("checks each blank-line paragraph, not the whole answer", () => {
    const ins = parseInstructions("exactly 3 paragraphs; each paragraph between 5 and 8 words");
    const w = (n: number) => Array(n).fill("word").join(" ");
    expect(checkInstructions(`${w(6)}\n\n${w(7)}\n\n${w(5)}`, ins, "paragraph").filter((i) => i.code === "word_count")).toEqual([]);
    expect(checkInstructions(`${w(6)}\n\n${w(12)}\n\n${w(5)}`, ins, "paragraph")[0]?.message).toMatch(/paragraph 2 has 12/);
  });
});

import { validateCandidate } from "@/lib/ai/deep/validators";
describe("unlabelled paragraph count", () => {
  it("three plain paragraphs satisfy 'exactly 3 paragraphs'; two do not", () => {
    const a = analyzeRequest("Write exactly 3 paragraphs about bottles, no headings.");
    expect(validateCandidate("One here.\n\nTwo here.\n\nThree here?", a).map((i) => i.code)).not.toContain("missing");
    expect(validateCandidate("One here.\n\nThree here?", a).map((i) => i.code)).toContain("count");
  });
});

import { checkInstructions as __ci, parseInstructions as __pi } from "@/lib/ai/deep/instructions";
describe("live 25-scene run: Hindi dialogue with English field labels", () => {
  it("does not flag Devanagari quoted dialogue because of 'Camera:'/'Bolt:' fields or translations", () => {
    const ins = __pi("Hindi dialogue where appropriate, attributed to the speaker");
    const scene = (n: number) => `### Scene ${n}: "Mission Briefing"\nDuration: 7 s\nBolt: Bolt (small robot, matte-silver chassis)\nCamera: Slow dolly in\nDialogue: Bolt: "कोर को सुरक्षित रखना है।" (We must secure the core.)\n`;
    const issues = __ci([1, 2].map(scene).join("\n"), ins, "scene");
    expect(issues.filter((i) => i.code === "script")).toEqual([]);
  });
});
describe("live 25-scene run: scenes without dialogue", () => {
  it("'Dialogue: None.' is not English dialogue and is allowed when dialogue is 'where appropriate'", () => {
    const ins = __pi("Hindi dialogue where appropriate");
    const txt = `### Scene 1: "Gate"\nBolt: Bolt (small robot)\nCamera: Pan left\nDialogue: None.\n\n### Scene 2: "Door"\nDialogue: Bolt: "चलो।"\n`;
    expect(__ci(txt, ins, "scene").filter((i) => i.code === "script" || i.code === "dialogue_missing")).toEqual([]);
  });
});
describe("live 25-scene run: 'Hindi Dialogue:' field with translation", () => {
  const ins = __pi("Hindi dialogue where appropriate, attributed to the speaker");
  const sc = (n: number, d: string) => `Scene ${n} – Title\nBolt: Small robot, teal chassis.\nCamera: Pan left.\nHindi Dialogue: ${d}\n`;
  it("accepts Devanagari with an English translation and attribution", () => {
    const txt = [sc(1, "बोल्ट, कोर की स्थिति रिपोर्ट करो (Bolt, report the core status) — spoken by Bolt (internal comms)."), sc(2, "None (no dialogue).")].join("\n");
    expect(__ci(txt, ins, "scene").filter((i) => i.code === "script")).toEqual([]);
  });
  it("still flags a non-Hindi word used as 'no dialogue' (seen live: 'nessuna')", () => {
    const issues = __ci(sc(1, "nessuna (no dialogue)."), ins, "scene");
    expect(issues.find((i) => i.code === "script")?.items).toEqual([1]);
  });
});
describe("live 25-scene run: quoted sign text in the visual prompt", () => {
  it("ignores English quotes outside the dialogue field (seen live: “STORM ALERT”)", () => {
    const ins = __pi("Hindi dialogue where appropriate");
    const txt = `Scene 1\nVisual Prompt: A screen reads “STORM ALERT” and “ENERGY CORE MISSING”.\nCamera: Pan.\nHindi Dialogue:\nBolt: “कोर कहाँ गायब हो गया?”\nContinuity: Opening.\n`;
    expect(__ci(txt, ins, "scene").filter((i) => i.code === "script")).toEqual([]);
  });
});
