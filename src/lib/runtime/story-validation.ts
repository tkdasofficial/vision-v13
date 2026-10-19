import { requestedStoryFields, storyDialogueRange, spokenStoryWords } from "../ai/story-output";

/** Validate the delivered artifact, not the runner's self-reported score. */
export function validateRuntimeStory(text: string, prompt: string): string[] {
  const requested = requestedStoryFields(prompt);
  const bounds = storyDialogueRange(prompt);
  if (!requested.length && !bounds) return [];
  const body = text.replace(/^`{3,}markdown\s*$/gm, "").replace(/^`{3,}\s*$/gm, "");
  const matches = Array.from(body.matchAll(/^\s*#{0,3}\s*Scene\s+(\d+)\b[^\n]*\n/gim));
  const expected = /\b(\d+)\s+scenes?\b/i.exec(prompt)?.[1];
  const issues: string[] = [];
  if (expected && (matches.length !== Number(expected) || matches.some((m, i) => Number(m[1]) !== i + 1)))
    issues.push(`Expected exactly ${expected} ordered scenes.`);
  const names: Record<string, string> = { action: "story line", visual: "visual prompt", dialogue: "dialogue", environment: "environment", camera: "camera direction" };
  for (const [i, match] of matches.entries()) {
    const start = match.index ?? 0;
    const scene = body.slice(start + match[0].length, matches[i + 1]?.index ?? body.length);
    const sections = Array.from(scene.matchAll(/^\s*#{2,3}\s+([^\n]+)\n([\s\S]*?)(?=^\s*#{2,3}\s|(?![\s\S]))/gm));
    const headings = sections.map((m) => m[1].trim().toLowerCase());
    for (const field of requested) if (!headings.includes(names[field])) issues.push(`Scene ${match[1]} is missing ${names[field]}.`);
    if (requested.length && headings.some((h) => !requested.some((field) => names[field] === h)))
      issues.push(`Scene ${match[1]} contains unrequested sections.`);
    if (bounds) {
      const dialogue = sections.find((m) => m[1].trim().toLowerCase() === "dialogue")?.[2] ?? "";
      const speech = dialogue.split("\n").map((line) => line.replace(/^\s*(?:[-*]\s*)?[^:\n]+:\s*/, ""));
      const words = spokenStoryWords(speech);
      if (words < bounds.min || words > bounds.max) issues.push(`Scene ${match[1]} dialogue has ${words} spoken words; required ${bounds.min}–${bounds.max}.`);
    }
  }
  if (!matches.length) issues.push("No independently labelled scenes were delivered.");
  return issues;
}