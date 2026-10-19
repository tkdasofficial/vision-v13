import { describe, it, expect, vi } from "vitest";
import { adoptDraftMode, loadChatMode, saveChatMode, type KV } from "@/lib/chat-mode-store";
import { CHAT_MODES } from "@/lib/ai/modes";
import { runDeepPipeline, parseReview, type CallResult } from "@/lib/ai/deep/pipeline";
import { analyzeRequest } from "@/lib/ai/deep/analyze";

const mem = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
const ok = (text: string): CallResult => ({ ok: true, text, finishReason: "stop" });

describe("per-chat mode persistence", () => {
  for (const { id } of CHAT_MODES) {
    it(`${id}: picked before the first message carries into the new chat and survives reload`, () => {
      const s = mem();
      saveChatMode(s, null, id);
      expect(loadChatMode(s, null)).toBe(id); // reload before sending
      expect(adoptDraftMode(s, "c1", "default")).toBe(id);
      expect(loadChatMode(s, "c1")).toBe(id); // reload / navigate back
      expect(loadChatMode(s, null)).toBeNull(); // next new chat starts fresh
    });
    it(`${id}: enabled inside an existing chat stays until changed, independent of other chats`, () => {
      const s = mem();
      saveChatMode(s, "a", id);
      saveChatMode(s, "b", "research");
      expect(loadChatMode(s, "a")).toBe(id);
      expect(loadChatMode(s, "b")).toBe("research");
    });
  }
  it("turning a mode off is saved as Default", () => {
    const s = mem(); saveChatMode(s, "a", "deep"); saveChatMode(s, "a", "default");
    expect(loadChatMode(s, "a")).toBe("default");
  });
  it("no draft uses the user's preferred default", () => {
    expect(adoptDraftMode(mem(), "x", "coding")).toBe("coding");
  });
});

describe("Deep Thinking review loop", () => {
  it("parses reviewer verdicts", () => {
    expect(parseReview("PASS").pass).toBe(true);
    expect(parseReview("ISSUES:\n- 2+2 is 4, not 5").issues).toEqual(["2+2 is 4, not 5"]);
  });
  it("plans, reviews, corrects and re-reviews before answering", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(ok("plan"))
      .mockResolvedValueOnce(ok("2+2 = 5"))
      .mockResolvedValueOnce(ok("ISSUES:\n- arithmetic is wrong"))
      .mockResolvedValueOnce(ok("2+2 = 4"))
      .mockResolvedValueOnce(ok("PASS"));
    const r = await runDeepPipeline({ messages: [{ role: "system", content: "s" }, { role: "user", content: "2+2?" }], analysis: analyzeRequest("2+2?"), call, request: "2+2?", plan: true, review: true });
    expect(r.stages).toEqual(["plan", "generate", "validate", "review", "correct", "revalidate", "review"]);
    expect(r.ok && r.text).toBe("2+2 = 4");
  });
  it("discloses when the review could not run instead of claiming verification", async () => {
    const call = vi.fn().mockResolvedValueOnce(ok("answer")).mockResolvedValue({ ok: false, status: 503, reason: "down" });
    const r = await runDeepPipeline({ messages: [], analysis: analyzeRequest("hi"), call, request: "hi", review: true });
    expect(r.ok && r.text).toMatch(/review step could not run/);
  });
});
