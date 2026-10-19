import { describe, it, expect } from "vitest";
import { rowsToConversation } from "@/context/ChatHistoryContext";

const T = "2026-10-01T10:00:00.000Z";
const row = (id: string, role: string, content: string, created_at = T) => ({ id, role, content, created_at, metadata: {} });

describe("rowsToConversation", () => {
  it("puts the question before its answer when timestamps tie", () => {
    const out = rowsToConversation([row("b", "assistant", "Hi there"), row("a", "user", "Hello")]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
  it("hides a repeated question that has no answer of its own", () => {
    const out = rowsToConversation([row("1", "user", "Q", "2026-10-01T10:00:00Z"), row("2", "assistant", "A", "2026-10-01T10:00:01Z"), row("3", "user", "Q", "2026-10-01T10:00:02Z")]);
    expect(out.map((m) => m.content)).toEqual(["Q", "A"]);
  });
  it("keeps a question the user really asked twice", () => {
    const out = rowsToConversation([row("1", "user", "Q", "2026-10-01T10:00:00Z"), row("2", "assistant", "A1", "2026-10-01T10:00:01Z"), row("3", "user", "Q", "2026-10-01T10:00:02Z"), row("4", "assistant", "A2", "2026-10-01T10:00:03Z")]);
    expect(out).toHaveLength(4);
  });
});
