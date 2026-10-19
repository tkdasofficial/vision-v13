import { describe, it, expect } from "vitest";
import { extractSource, asksToChangeContent, sourceBlock } from "@/lib/ai/references";

describe("ready content is not rewritten", () => {
  it("PDF of an existing story needs no writing", () => {
    expect(asksToChangeContent("create PDF of the story")).toBe(false);
    expect(asksToChangeContent("convert it to PDF")).toBe(false);
  });
  it("new or changed content needs writing", () => {
    expect(asksToChangeContent("write a story in PDF")).toBe(true);
    expect(asksToChangeContent("translate the story to Hindi and make a PDF")).toBe(true);
  });
  it("recovers the exact source from the tool prompt", () => {
    const block = sourceBlock({ kind: "found", content: "Once upon a time.", label: "the story", role: "assistant", ordinal: 2 } as any);
    expect(extractSource(`create PDF of the story\n\n${block}`)).toEqual({ request: "create PDF of the story", source: "Once upon a time." });
  });
});
