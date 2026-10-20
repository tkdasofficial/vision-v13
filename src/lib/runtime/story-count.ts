/** Shared existing count semantics for generation and delivered-artifact gates. */
export function storySceneCount(prompt: string): number {
  const match = /(\d{1,2})\s*[- ]?(?:scenes?|prompts?|chapters?|episodes?|parts?)\b/i.exec(prompt);
  const count = match ? Number(match[1]) : 5;
  return !Number.isInteger(count) || count < 1 ? 5 : Math.min(count, 25);
}