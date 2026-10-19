import { describe, it, expect } from "vitest";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { validateCandidate } from "@/lib/ai/deep/validators";
import { parseRequiredNames, splitItems } from "@/lib/ai/deep/instructions";
import { remarkCallouts } from "@/components/chat/rich-blocks";
import { fromMarkdown } from "mdast-util-from-markdown";

const REQ = "Write 20 prompts for a story about a lost robot finding its way home. Number them 1 to 20, keep the robot named Bolt in every prompt, and keep events in order.";
const callout = (md: string) => { const t: any = fromMarkdown(md); (remarkCallouts() as any)(t); return t.children.map((c: any) => c.data?.hProperties?.["data-callout"] ?? c.type); };

describe("Iterative accuracy repair regressions", () => {
  it("extracts the required name from the live Bolt request", () => {
    expect(parseRequiredNames(REQ)).toEqual(["Bolt"]);
    expect(analyzeRequest(REQ).instructions?.requiredNames).toEqual(["Bolt"]);
  });
  it("flags the exact prompts where Bolt became a pronoun", () => {
    const list = Array.from({ length: 20 }, (_, i) => `${i + 1}. ${[3, 10, 12].includes(i) ? "He walks on." : "Bolt walks on."}`).join("\n");
    const issue = validateCandidate(list, analyzeRequest(REQ)).find((i) => i.code === "required_name");
    expect(issue?.message).toMatch(/4, 11, 13/);
    const fixed = list.replace(/He walks/g, "Bolt walks");
    expect(validateCandidate(fixed, analyzeRequest(REQ))).toEqual([]);
  });
  it("numbered items inside a markdown fence are found", () => {
    expect(splitItems("```markdown\n1. Bolt a\n2. Bolt b\n```", "prompt").map((i) => i.num)).toEqual([1, 2]);
  });
  it("unnumbered output fails the numbering/count check", () => {
    const lines = Array.from({ length: 20 }, () => "Bolt walks on.").join("\n");
    expect(validateCandidate(lines, analyzeRequest(REQ)).map((i) => i.code)).toContain("missing");
  });
  it("Note markers render as callouts in every common form", () => {
    expect(callout("> [!NOTE]\n> Body")).toEqual(["note"]);
    expect(callout("[!NOTE]\nBody text")).toEqual(["note"]);
    expect(callout("[!WARNING]\n\nBody on next paragraph")).toEqual(["warning"]);
    expect(callout("> **[!TIP]** Body")).toEqual(["tip"]);
    expect(callout("Plain [link] text\n\n1. one\n2. two")).toEqual(["paragraph", "list"]);
  });
});

import { allClaims } from "@/lib/ai/factcheck";
describe("fact-check claim picking", () => {
  it("never treats a heading as a claim", () => {
    const c = allClaims("Blood Path (Numbered List)\n\n## Right Atrium Function\n\nThe right atrium receives blood from the superior vena cava in 1 beat.");
    expect(c.some((x) => /Numbered List|Right Atrium Function/.test(x))).toBe(false);
  });
});
