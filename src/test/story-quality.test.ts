import { describe, it, expect } from "vitest";
import { parseQualityReview, replaceStoryParagraph, blueprintInstructions, readQualityCheckpoint, validateQualityBlueprint } from "@/lib/runtime/story-quality";
import { validateRuntimeStory } from "@/lib/runtime/story-validation";
import { validateScene, checkStory } from "@/lib/runtime/cloud-story";

const report = (issues: unknown[] = [], checks = {}) => JSON.stringify({ checks: { story: true, visual: true, dialogue: true, continuity: true, instructions: true, structure: true, ...checks }, issues });
const scene = (n: number, visual: string, dialogue = "Mira: Hold steady.") => `## Scene ${n}\n\n### Visual Prompt\n${visual}\n\n### Dialogue\n${dialogue}\n`;
describe("structured story quality findings", () => {
  it.each([
    ["continuity", "Pip operates radar.", "Use Mira's established human capability."],
    ["continuity", "Rope is tied to the pier bollard.", "Show Mira transferring it from the lighthouse post."],
    ["visual", "Mira wears a green coat.", "Keep her canonical yellow raincoat."],
    ["dialogue", "Pip: I plotted the course.", "Replace with Mira's dialogue; ordinary Pip cannot speak."],
  ])("preserves an evidence-linked %s failure for targeted repair", (category, evidence, correction) => {
    const scenes = [scene(1, "Rope on lighthouse post."), scene(2, evidence)];
    const finding = { severity: "critical", category, sceneId: "scene:2", reference: "original request and neighboring state", evidence, correction };
    expect(parseQualityReview(report([finding]), "Story.", scenes)).toEqual([finding]);
  });
  it("allows an established fantasy world and distinguishes stylistic warnings", () => {
    const scenes = [scene(1, "Wizard cat Pip operates magical radar.")];
    const warning = { severity: "warning", category: "story", sceneId: "scene:1", reference: "style", evidence: "Wizard cat", correction: "Optional: vary sentence rhythm." };
    expect(parseQualityReview(report([warning]), "", scenes)).toEqual([warning]);
    expect(blueprintInstructions(5)).toContain("respect intentional fantasy/science fiction");
  });
  it("rejects ungrounded findings, missing checks and stale scene evidence", () => {
    const issue = { severity: "critical", category: "continuity", sceneId: "scene:6", reference: "state", evidence: "radar", correction: "Repair." };
    expect(() => parseQualityReview(report([issue]), "", [scene(1, "Boat.")])).toThrow();
    expect(() => parseQualityReview(report([], { visual: false }), "", [])).toThrow();
  });
  it("replaces exactly the affected paragraph, not approved neighboring prose", () => {
    const story = "Approved first paragraph.\n\nPip uses radar.\n\nApproved resolution.";
    expect(replaceStoryParagraph(story, "paragraph:2", "Mira uses radar; Pip meows.")).toBe("Approved first paragraph.\n\nMira uses radar; Pip meows.\n\nApproved resolution.");
    expect(() => replaceStoryParagraph(story, "paragraph:4", "Replacement.")).toThrow();
  });
  it("legacy metadata does not falsely imply a successful semantic review", () => {
    expect(readQualityCheckpoint('{"score":100}')).toEqual({ version: 1, refs: {}, repairs: {} });
  });
  it("does not approve an unstructured or incomplete new character blueprint", () => {
    expect(() => validateQualityBlueprint("Mira and her cat.", 5)).toThrow();
    expect(() => validateQualityBlueprint(JSON.stringify({ characters: [{ name: "Pip" }], beats: [] }), 5)).toThrow();
  });
});
describe("deterministic story quality gates", () => {
  it("checks default scene counts and alternate prompt counts without explicit fields", () => {
    expect(validateRuntimeStory(scene(1, "Boat."), "Create a story")).toContain("Expected exactly 5 ordered scenes.");
    expect(validateRuntimeStory(scene(1, "Boat."), "Create 2 prompts")).toContain("Expected exactly 2 ordered scenes.");
  });
  it("rejects empty visual content and wrong scene numbering", () => {
    expect(validateScene(scene(2, ""), 0, "Create 1 scene")).toContain("Scene 1 has the wrong scene number.");
    expect(validateRuntimeStory(scene(1, ""), "Create 1 scene")).toContain("Scene 1 has empty visual prompt.");
  });
  it("rejects a multi-scene candidate and preserves zero-count default semantics", () => {
    expect(validateScene(scene(1, "Boat.") + scene(2, "Pier."), 0, "Create 2 scenes")).toContain("A scene candidate must contain exactly one scene heading.");
    expect(validateRuntimeStory(scene(1, "Boat."), "Create 0 scenes")).toContain("Expected exactly 5 ordered scenes.");
  });
  it("rejects repeated long prompts without deleting required scenes or intentional refrains", () => {
    const repeated = "Mira holds the lighthouse rescue rope while Pip watches the struggling fishing boat and the storm waves striking the pier. ".repeat(2);
    const document = scene(1, repeated) + scene(2, repeated);
    expect(validateRuntimeStory(document, "Create 2 scenes")).toContain("Scene 2 duplicates visual prompt from scene 1.");
    expect(validateRuntimeStory(document, "Create 2 scenes with identical prompts")).toEqual([]);
    expect(checkStory(`${repeated}\n\n${repeated}\n\n${"Other prose. ".repeat(130)}`)).toContain("The story contains duplicate narrative paragraphs.");
  });
});