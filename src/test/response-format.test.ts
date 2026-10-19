import { describe, expect, it } from "vitest";
import { autoCopySections } from "@/lib/ai/response-format";

describe("automatic reusable sections", () => {
  it("frames scene prompts and dialogues independently without duplicating content", () => {
    const source = "## Scene 1\n\n### Visual Prompt\nA lighthouse in a storm.\n\n### Dialogue\nMira: Stay close.\n\n## Notes\nCheck the light.";
    const result = autoCopySections(source);
    expect(result.match(/````markdown/g)).toHaveLength(2);
    expect(result.split("A lighthouse in a storm.")).toHaveLength(2);
    expect(result).toContain("````\n\n## Notes\nCheck the light.");
  });
  it("preserves existing and partially streamed fences exactly", () => {
    for (const source of ["## Prompt 1\n\n```markdown\nUse **rain**.\n```", "```text\n# Story\nKeep literal", "````markdown\n# Story\n```js\nconst a = 1;\n```\n````"]) {
      expect(autoCopySections(source)).toBe(source);
    }
  });
  it("does not box discussion or ordinary sections", () => {
    const source = "## How prompts work\nPrompts describe a task.\n\n## Summary\nUse clear dialogue and story structure.";
    expect(autoCopySections(source)).toBe(source);
  });
  it("leaves tables independent and frames a labelled chart specification", () => {
    const table = "## Chart Data\n\n| Day | Count |\n| --- | --- |\n| Mon | 2 |";
    expect(autoCopySections(table)).toBe(table);
    const result = autoCopySections("## Chart Specification\nUse a bar chart of daily sales.\n\n## Explanation\nBars compare days.");
    expect(result).toContain("````markdown\nUse a bar chart of daily sales.");
    expect(result).toContain("## Explanation\nBars compare days.");
  });
  it("keeps nested headings in a complete story and is idempotent", () => {
    const source = "## Story\n### Arrival\nThe keeper returns.\n\n## Notes\nEnd.";
    const once = autoCopySections(source);
    expect(once).toContain("````markdown\n### Arrival\nThe keeper returns.");
    expect(autoCopySections(once)).toBe(once);
  });
});