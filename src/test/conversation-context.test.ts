import { describe, it, expect } from "vitest";
import { resolveReference, sourceBlock, artifactMatchesSource, workingContext, type ConvMsg } from "@/lib/ai/references";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { validateCandidate, checkContinuity } from "@/lib/ai/deep/validators";

const chat: ConvMsg[] = [
  { id: "u1", role: "user", content: "Tell me about the Moon" },
  { id: "a1", role: "assistant", content: "The Moon is Earth's only natural satellite, about 384,400 km away." },
  { id: "u2", role: "user", content: "Now write a story about a fox" },
  { id: "a2", role: "assistant", content: "Once upon a time a clever fox crossed the frozen river at dawn." },
];

describe("Conversation memory & reference resolution", () => {
  it("4: resolves 'first response' to the first assistant message", () => {
    const r = resolveReference("Create a PDF of your first response", chat);
    expect(r.kind === "found" && r.id).toBe("a1");
  });
  it("5: 'second response' skips user messages", () => {
    const r = resolveReference("Translate the second response into Hindi", chat);
    expect(r.kind === "found" && r.id).toBe("a2");
  });
  it("6/7: PDF source carries full content; a phrase-only file is rejected", () => {
    const r = resolveReference("Create a PDF of your first response", chat);
    expect(sourceBlock(r)).toContain("384,400 km");
    expect(artifactMatchesSource("The Moon is Earth's only natural satellite, about 384,400 km away.", chat[1].content as string).ok).toBe(true);
    expect(artifactMatchesSource("first response", chat[1].content as string).ok).toBe(false);
  });
  it("8: older answer outside the recent window is still retrieved", () => {
    const long: ConvMsg[] = [...chat, ...Array.from({ length: 60 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as any, content: `turn ${i} ${"x".repeat(2000)}` }))];
    expect(long.slice(-30).some((m) => String(m.content).includes("384,400"))).toBe(false);
    const r = resolveReference("What did you say in your first response?", long);
    expect(r.kind === "found" && r.content).toContain("384,400");
  });
  it("9: active requirements persist; later correction replaces earlier", () => {
    const w = workingContext([{ role: "user", content: "Always answer in English." }, { role: "user", content: "Keep it under 100 words." }, { role: "user", content: "Actually, always answer in Hindi." }]);
    expect(w.instructions.join(" ")).toMatch(/Hindi/);
    expect(w.instructions.join(" ")).not.toMatch(/English/);
    expect(w.instructions.join(" ")).toMatch(/100 words/);
  });
  it("10: conversations are isolated", () => {
    const other: ConvMsg[] = [{ role: "user", content: "hi" }, { role: "assistant", content: "Recipe for pasta" }];
    const r = resolveReference("your first response", other);
    expect(r.kind === "found" && r.content).toBe("Recipe for pasta");
  });
  it("11: reopened chat rebuilds working context from history", () => {
    expect(workingContext(chat).summary).toMatch(/Moon/);
  });
  it("12: ambiguous 'earlier' reference asks one question", () => {
    const three = [...chat, { role: "user", content: "another" }, { role: "assistant", content: "Third answer here." }] as ConvMsg[];
    expect(resolveReference("Modify the earlier version", three).kind).toBe("ambiguous");
  });
  it("13: missing source is reported, not invented", () => {
    const r = resolveReference("Shorten your fifth answer", chat);
    expect(r.kind).toBe("missing");
    expect(sourceBlock(r)).toBe("");
  });
  it("15: forgetting a topic drops it from active context", () => {
    const w = workingContext([{ role: "user", content: "Always mention Paris." }, { role: "user", content: "Forget Paris." }]);
    expect(w.instructions).toEqual([]);
  });
  it("16: source is bounded by budget", () => {
    const big = [{ role: "user", content: "x" }, { role: "assistant", content: "y".repeat(100000) }] as ConvMsg[];
    expect(sourceBlock(resolveReference("your first answer", big), 1000).length).toBeLessThan(1500);
  });
});

describe("Accuracy validation", () => {
  const scene = (n: number, d: number, s = "hero at door", e = "hero at door") => `Scene ${n}: x\nStarting state: ${s}\nEnding state: ${e}\nDuration: ${d}s`;
  it("1: eight scenes totalling 50s pass; wrong total is caught", () => {
    const a = analyzeRequest("Write 8 scenes for a 50 second audio using 4, 6, 8 or 10 second clips");
    const good = [8, 6, 6, 6, 6, 6, 6, 6].map((d, i) => scene(i + 1, d)).join("\n\n");
    expect(validateCandidate(good, a)).toEqual([]);
    const bad = [8, 8, 6, 6, 6, 6, 6, 6].map((d, i) => scene(i + 1, d)).join("\n\n");
    expect(validateCandidate(bad, a).map((i) => i.code)).toContain("duration_total");
  });
  it("2: missing and duplicate scenes are caught", () => {
    const a = analyzeRequest("Write 4 scenes");
    expect(validateCandidate([1, 2, 2].map((n) => scene(n, 6)).join("\n\n"), a).map((i) => i.code)).toEqual(expect.arrayContaining(["missing", "duplicate"]));
  });
  it("3: start state conflicting with previous end is caught", () => {
    const t = scene(1, 6, "hero at door", "hero inside kitchen") + "\n\n" + scene(2, 6, "villain rooftop chase", "x");
    expect(checkContinuity(t).map((i) => i.code)).toEqual(["continuity"]);
  });
});

describe("Implicit story reference", () => {
  it("'create PDF of the story' uses the story already in the chat", () => {
    const r = resolveReference("Create PDF of the story", chat);
    expect(r.kind === "found" && r.id).toBe("a2");
  });
  it("'convert it to PDF' uses the latest answer", () => {
    const r = resolveReference("convert it to pdf", chat);
    expect(r.kind === "found" && r.id).toBe("a2");
  });
});
