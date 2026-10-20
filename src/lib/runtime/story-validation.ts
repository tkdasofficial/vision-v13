import { requestedStoryFields, storyDialogueRange, spokenStoryWords } from "../ai/story-output";

/** Validate the delivered artifact, not the runner's self-reported score. */
export function validateRuntimeStory(text: string, prompt: string, options: { sceneOnly?: boolean } = {}): string[] {
  const requested = requestedStoryFields(prompt);
  const bounds = storyDialogueRange(prompt);
  const body = text.replace(/^`{3,}markdown\s*$/gm, "").replace(/^`{3,}\s*$/gm, "");
  const matches = Array.from(body.matchAll(/^\s*#{0,3}\s*Scene\s+(\d+)\b[^\n]*\n/gim));
  const rawCount = /(\d{1,2})\s*[- ]?(?:scenes?|prompts?|chapters?|episodes?|parts?)\b/i.exec(prompt)?.[1];
  const expected = Math.min(25, Math.max(1, Number(rawCount) || 5));
  const issues: string[] = [];
  const preamble = body.slice(0, matches[0]?.index ?? body.length);
  if (/^\s*(?:#{1,6}\s*)?[*_]*(?:visual prompt|dialogue)[*_]*\s*(?::|$)/im.test(preamble))
    issues.push("Scene components were repeated outside the numbered scenes.");
  if (!options.sceneOnly && (matches.length !== expected || matches.some((m, i) => Number(m[1]) !== i + 1)))
    issues.push(`Expected exactly ${expected} ordered scenes.`);
  const names: Record<string, string> = { action: "story line", visual: "visual prompt", dialogue: "dialogue", environment: "environment", camera: "camera direction" };
  const fields = requested.length ? requested : ["visual", "dialogue"];
  const seen = new Map<string, number>();
  for (const [i, match] of matches.entries()) {
    const start = match.index ?? 0;
    const scene = body.slice(start + match[0].length, matches[i + 1]?.index ?? body.length);
    const sections = Array.from(scene.matchAll(/^\s*#{2,3}\s+([^\n]+)\n([\s\S]*?)(?=^\s*#{2,3}\s|(?![\s\S]))/gm));
    const headings = sections.map((m) => m[1].trim().toLowerCase());
    for (const heading of new Set(headings)) {
      if (headings.filter((h) => h === heading).length > 1) issues.push(`Scene ${match[1]} repeats ${heading}.`);
    }
    for (const field of fields) {
      const section = sections.find((s) => s[1].trim().toLowerCase() === names[field]);
      if (!section) issues.push(`Scene ${match[1]} is missing ${names[field]}.`);
      else if (!section[2].replace(/[`*_\s]/g, "")) issues.push(`Scene ${match[1]} has empty ${names[field]}.`);
    }
    const actualOrder = headings.filter((h) => fields.some((f) => names[f] === h));
    if (actualOrder.length === fields.length && actualOrder.some((h, n) => h !== names[fields[n]])) issues.push(`Scene ${match[1]} has sections in the wrong order.`);
    if (headings.some((h) => !fields.some((field) => names[field] === h)))
      issues.push(`Scene ${match[1]} contains unrequested sections.`);
    for (const section of sections) {
      const value = section[2].toLowerCase().replace(/\s+/g, " ").trim();
      // Exact long blocks only: short recurring details/refrains are not duplicate scenes.
      if (value.length < 120) continue;
      const key = `${section[1].trim().toLowerCase()}:${value}`;
      const previous = seen.get(key);
      if (previous && !/\b(refrain|repeat(?:ed)? dialogue|same dialogue|identical prompts)\b/i.test(prompt)) issues.push(`Scene ${match[1]} duplicates ${section[1].trim().toLowerCase()} from scene ${previous}.`);
      else seen.set(key, Number(match[1]));
    }
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