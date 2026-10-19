import { extractSource } from "./references";

/** Spoken dialogue budgets exclude labels, headings and delivery directions. */
export function storyDialogueRange(prompt: string): { min: number; max: number } | null {
  const request = extractSource(prompt)?.request ?? prompt;
  const match = /([0-9]+)\s*(?:to|[-–])\s*([0-9]+)\s+words?\s+(?:of\s+)?dialogues?/i.exec(request)
    ?? /dialogues?[^.!?\n]{0,40}?([0-9]+)\s*(?:to|[-–])\s*([0-9]+)\s+words?/i.exec(request);
  return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}

export function spokenStoryWords(lines: string[]): number {
  return lines.join(" ").replace(/\([^)]*\)|\[[^\]]*\]/g, "").match(/\p{L}[\p{L}\p{M}\p{N}]*(?:['’][\p{L}\p{M}]+)*|\p{N}+/gu)?.length ?? 0;
}

export function requiresFixedStoryBackground(prompt: string): boolean {
  return /background[^.!?\n]{0,40}(?:constant|same|unchanged|fixed)|(?:constant|same|unchanged|fixed)[^.!?\n]{0,40}background/i.test(prompt);
}

/** Delivery clauses select outputs; character lists and consistency rules remain inputs. */
export function requestedStoryFields(prompt: string): string[] {
  const request = extractSource(prompt)?.request ?? prompt;
  const clauses = Array.from(request.matchAll(/(?:give|provide|return|output|deliver|show)\s+(?:me\s+)?([^.!?\n]+)/gi), (m) => m[1]);
  if (/\b(?:only|just)\b/i.test(request)) clauses.push(request);
  const fields: [string, RegExp][] = [["action", /story line/i], ["visual", /visual prompts?/i], ["dialogue", /dialogues?/i], ["environment", /environment/i], ["camera", /camera(?: direction)?/i]];
  return fields.filter(([, pattern]) => clauses.some((clause) => pattern.test(clause))).map(([field]) => field);
}

/** Only request instructions can opt into a downloadable story. */
export function wantsStoryFile(prompt: string): boolean {
  const request = (extractSource(prompt)?.request ?? prompt).split("<<<SOURCE")[0];
  const directives = request.split(/[.!?;\n]|\bbut\b/i).filter((clause) => /\b(?:file|download|attachment|export|save\s+as)\b/i.test(clause));
  const last = directives.at(-1);
  return !!last && !/\b(?:don['’]?t|do\s+not|never|without|no)\b/i.test(last);
}