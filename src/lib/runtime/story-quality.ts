import { parseStoryJson, reviewSchema, storyReviewIssues, STORY_REVIEW_PROMPT, type StoryIssue } from "../ai/deep/story";
import { z } from "zod";

export const QUALITY_LIMITS = { maxRepairs: 6, perSection: 2 } as const;
const details = z.union([z.string().min(1), z.array(z.string()).min(1), z.record(z.unknown())]);
const blueprintSchema = z.object({
  worldRules: details,
  characters: z.array(z.object({ name: z.string().min(1), appearance: details, clothing: details, personality: details, motivation: details, abilities: details, limitations: details, relationships: details })).min(1),
  visualContinuity: z.object({ locations: details, props: details, lighting: details, weather: details }),
  beats: z.array(z.object({ scene: z.number().int().positive(), goal: details, obstacle: details, consequence: details, emotion: details, before: details, after: details, transition: details, unresolved: details })).min(1),
});
/** New blueprints must be complete profiles/ordered beats; legacy saved ones remain resumable. */
export function validateQualityBlueprint(raw: string, count: number): void {
  const blueprint = parseStoryJson(raw, blueprintSchema);
  if (blueprint.beats.length !== count || blueprint.beats.some((beat, index) => beat.scene !== index + 1)) throw new Error("Blueprint does not contain the required ordered beats; draft retained.");
  const names = blueprint.characters.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("Blueprint has duplicate character identities; draft retained.");
}
export const blueprintInstructions = (count: number) => `Create a master blueprint for the requested story: concise structured JSON with worldRules, characters [{name,appearance,clothing,personality,motivation,abilities,limitations,relationships}], visualContinuity {locations,props,lighting,weather}, and exactly ${count} ordered beats [{scene,goal,obstacle,consequence,emotion,before,after,transition,unresolved}]. Track character locations, prop positions/attachments, injuries, knowledge and unresolved problems in before/after. Each before must follow the previous after; explain rope transfers, travel, recovery and elapsed time. Normal animals cannot operate human equipment or speak unless the request establishes those abilities; respect intentional fantasy/science fiction. Plan tension, meaningful choices and earned resolution. Do not invent abilities to solve obstacles; no prose story.`;
export const qualityReviewInstructions = STORY_REVIEW_PROMPT + ` Review actual prose and every numbered scene together, including neighboring boundaries. Check cause/effect, location/time, rope/prop attachment transfers, injuries, capabilities, appearance/clothing, weather/light progression, dialogue speaker/relevance/repetition, visual completeness and narrative agreement. Respect explicitly established fantasy and intentional refrains; subjective style is warning only. A critical issue requires exact conflicting evidence from the affected content and a concrete correction. sceneId must be "scene:N" or "story"; story references must be "paragraph:N" using the supplied paragraph numbering. Never propose a whole-story rewrite. Do not claim unexamined checks passed.`;

export function parseQualityReview(raw: string, story: string, scenes: string[]): StoryIssue[] {
  const findings = storyReviewIssues(parseStoryJson(raw, reviewSchema), "audit");
  for (const finding of findings.filter((f) => f.severity === "critical")) {
    const index = /^scene:(\d+)$/.exec(finding.sceneId);
    const paragraph = /^paragraph:(\d+)$/.exec(finding.reference);
    const source = index ? scenes[Number(index[1]) - 1] : finding.sceneId === "story" && paragraph ? story.split(/\n\s*\n/)[Number(paragraph[1]) - 1] : undefined;
    if (!source || !source.includes(finding.evidence) || !finding.correction.trim()) throw new Error("Story review has an unsupported target or ungrounded finding; saved drafts retained.");
  }
  return findings;
}

export function replaceStoryParagraph(story: string, reference: string, replacement: string): string {
  const match = /^paragraph:(\d+)$/.exec(reference);
  const paragraphs = story.split(/\n\s*\n/);
  const index = match ? Number(match[1]) - 1 : -1;
  if (index < 0 || index >= paragraphs.length || !replacement.trim() || /\n\s*\n/.test(replacement.trim())) throw new Error("Invalid local story repair; original draft retained.");
  paragraphs[index] = replacement.trim();
  return paragraphs.join("\n\n");
}

export type QualityCheckpoint = { version: 1; hash?: string; passed?: boolean; findings?: StoryIssue[]; repairs: Record<string, number>; refs: Record<string, string> };
export function readQualityCheckpoint(raw: string | null | undefined): QualityCheckpoint {
  if (raw) { try { const value = JSON.parse(raw); if (value.version === 1 && value.repairs && value.refs) return value; } catch { /* Legacy slot metadata is not an approved audit. */ } }
  return { version: 1, repairs: {}, refs: {} };
}