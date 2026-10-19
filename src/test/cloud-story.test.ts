import { describe, it, expect } from "vitest";
import { checkStory, storyInstructions, parseSceneCount, sceneContract, sceneHeadings, validateScene, scoreScene, assembleStoryDocument, validateAssembled, STORY_LIMITS } from "@/lib/runtime/cloud-story";

const HORROR = "Create a horror story in exactly 5 scenes. Give me the full story plus, for each scene, a visual prompt and dialogue. Each scene must contain 25 to 30 words of dialogue. Keep the same characters, clothing and one fixed background.";

function sceneWith(words: number, n = 1): string {
  const line = "MARA: " + Array.from({ length: words }, (_, i) => `w${i + 1}`).join(" ");
  return `## Scene ${n}\n\n### Visual Prompt\nA dim cabin interior, dust in the air.\n\n### Dialogue\n${line}\n`;
}

describe("parseSceneCount", () => {
  it("reads the requested scene count", () => {
    expect(parseSceneCount(HORROR)).toBe(5);
    expect(parseSceneCount("write 10 prompts for a story")).toBe(10);
  });
  it("defaults to 5 when no count is named", () => {
    expect(parseSceneCount("write a story about a lighthouse")).toBe(5);
  });
  it("caps at the per-request maximum of 25", () => {
    expect(parseSceneCount("write 40 scenes about a city")).toBe(25);
    expect(STORY_LIMITS.maxScenes).toBe(25);
  });
});

describe("sceneContract", () => {
  it("names the requested sections in order", () => {
    expect(sceneHeadings(HORROR)).toEqual(["Visual Prompt", "Dialogue"]);
    const c = sceneContract(HORROR);
    expect(c).toContain("Visual Prompt");
    expect(c).toContain("Dialogue");
  });
  it("carries the dialogue word range and fixed-background rule", () => {
    const c = sceneContract(HORROR);
    expect(c).toContain("25 to 30 spoken words");
    expect(c).toContain("same single background");
  });
});

describe("validateScene", () => {
  it("accepts a scene inside the dialogue range", () => {
    expect(validateScene(sceneWith(27), 0, HORROR)).toEqual([]);
  });
  it("rejects dialogue outside the range", () => {
    const issues = validateScene(sceneWith(10), 0, HORROR);
    expect(issues.some((i) => i.includes("spoken words"))).toBe(true);
  });
  it("rejects a missing requested section", () => {
    const noDialogue = "## Scene 1\n\n### Visual Prompt\nA dim cabin.\n";
    expect(validateScene(noDialogue, 0, HORROR).some((i) => i.includes("dialogue"))).toBe(true);
  });
  it("rejects unrequested sections", () => {
    const extra = sceneWith(27).replace("### Dialogue", "### Camera Direction\nPan left.\n\n### Dialogue");
    expect(validateScene(extra, 0, HORROR).some((i) => i.includes("unrequested"))).toBe(true);
  });
});

describe("scoreScene", () => {
  it("scores a fully valid scene 100", () => {
    expect(scoreScene(sceneWith(27), 0, HORROR)).toEqual({ score: 100, issues: [] });
  });
  it("scores a scene with issues below the 90 pass mark", () => {
    const { score, issues } = scoreScene(sceneWith(10), 0, HORROR);
    expect(issues.length).toBeGreaterThan(0);
    expect(score).toBeLessThan(90);
  });
});

describe("assembleStoryDocument", () => {
  it("delivers story then scenes in order, never the blueprint", () => {
    const scenes = Array.from({ length: 5 }, (_, i) => sceneWith(26, i + 1));
    const doc = assembleStoryDocument({ story: "A long horror story body.", scenes });
    expect(doc).not.toContain("Blueprint");
    expect(doc.indexOf("## Story")).toBeLessThan(doc.indexOf("## Scene 1"));
    expect(doc.indexOf("## Scene 1")).toBeLessThan(doc.indexOf("## Scene 5"));
    expect(validateAssembled(doc, HORROR)).toEqual([]);
  });
  it("flags a wrong scene count in the assembled document", () => {
    const doc = assembleStoryDocument({ story: "S", scenes: [sceneWith(26, 1), sceneWith(26, 2)] });
    expect(validateAssembled(doc, HORROR).some((i) => i.includes("exactly 5"))).toBe(true);
  });
});

describe("checkStory", () => {
  const prose = "The fog rolled over the manor while Evelyn waited. ".repeat(30);
  it("accepts continuous prose of at least 250 words", () => {
    expect(checkStory(prose)).toEqual([]);
  });
  it("rejects a story written as scene prompts", () => {
    expect(checkStory(`## Scene 1\n\n### Visual Prompt\nA hall.\n\n### Dialogue\nEVELYN: hello\n\n${prose}`).length).toBeGreaterThan(0);
  });
  it("rejects a story that is too short", () => {
    expect(checkStory("A short tale.")[0]).toContain("too short");
  });
  it("tells the writer to avoid scene headings", () => {
    expect(storyInstructions(5)).toContain("all 5 story beats");
    expect(storyInstructions(5)).toContain("Do not use headings");
  });
});
