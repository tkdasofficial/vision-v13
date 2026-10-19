import { describe, expect, it } from "vitest";
import { validateRuntimeStory } from "@/lib/runtime/story-validation";

const prompt = "Create a story of 10 scenes, each scene have 25 to 30 words dialogue, and give me both visual prompt & dialogue of each scenes.";
const output = (words = 27) => Array.from({ length: 10 }, (_, i) => `Scene ${i + 1}: Homework\n\n\`\`\`\`markdown\n## Visual Prompt\nMonkey and Rabbit work in the classroom.\n\`\`\`\`\n\n\`\`\`\`markdown\n## Dialogue\nMonkey (quietly): ${"homework ".repeat(words)}\n\`\`\`\``).join("\n\n");

describe("runtime story acceptance", () => {
  it("accepts exactly ten scenes with the requested two components and 27 spoken words", () => {
    expect(validateRuntimeStory(output(), prompt)).toEqual([]);
  });
  it.each([24, 31])("blocks %i spoken words despite an intact artifact", (words) => {
    expect(validateRuntimeStory(output(words), prompt).filter((i) => i.includes("spoken words"))).toHaveLength(10);
  });
  it("blocks missing and additional scenes", () => {
    expect(validateRuntimeStory(output().replace("Scene 10:", "Scene 11:"), prompt)).toContain("Expected exactly 10 ordered scenes.");
  });
  it("blocks extra content sections", () => {
    expect(validateRuntimeStory(output() + "\n## Story Line\nExtra story", prompt).some((i) => i.includes("unrequested"))).toBe(true);
  });
});