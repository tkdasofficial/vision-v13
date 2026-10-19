import { describe, expect, it } from "vitest";
import { rankPastChats, pastChatsBlock, memorySwitches } from "@/lib/ai/memory";
import { parsePrefs } from "@/lib/settings";
import { changedSince } from "@/lib/memory-client";

const row = (chatId: string, content: string, role = "user") => ({ chatId, title: "t", role, content, createdAt: "" });

describe("ChatGPT-style memory", () => {
  it("both memory switches default on and can be turned off", () => {
    expect(memorySwitches(parsePrefs({}))).toEqual({ saved: true, history: true });
    expect(memorySwitches(parsePrefs({ savedMemories: false, chatHistory: false }))).toEqual({ saved: false, history: false });
  });
  it("chat history only brings relevant earlier chats, never the current one", () => {
    const rows = [row("a", "My lighthouse story about Mira"), row("b", "Pasta recipe"), row("cur", "lighthouse here")];
    expect(rankPastChats(rows, "cur", "continue the lighthouse story").map((r) => r.chatId)).toEqual(["a"]);
    expect(rankPastChats(rows, "cur", "zzz quantum")).toEqual([]);
    expect(pastChatsBlock(rankPastChats(rows, "cur", "lighthouse"))).toContain("Chat history memory");
  });
  it("memory notice shows only for writes during the reply", () => {
    const m = (updatedAt: number) => ({ id: "1", content: "x", createdAt: 0, updatedAt, source: "auto" });
    expect(changedSince([m(5000)], 5000)).toBe(true);
    expect(changedSince([m(1000)], 5000)).toBe(false);
  });
});
