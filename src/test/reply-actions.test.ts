import { describe, expect, it } from "vitest";
import { branchReplies, deleteReply } from "@/lib/reply-actions";
import { buildMetadata, rowsToConversation } from "@/context/ChatHistoryContext";
import { mergeChatJobs } from "@/lib/builder/job-recovery";
import type { ChatMessage } from "@/lib/types";

const messages: ChatMessage[] = [
  { id: "u", role: "user", content: "Question", timestamp: new Date(1) },
  { id: "a", role: "assistant", content: "Answer", timestamp: new Date(2) },
  { id: "u2", role: "user", content: "Later", timestamp: new Date(3) },
];
describe("reply actions", () => {
  it("deletes only the selected reply and persists its tombstone", () => {
    const result = deleteReply(messages, "a");
    expect(result.filter((m) => !m.deleted).map((m) => m.id)).toEqual(["u", "u2"]);
    const [restored] = rowsToConversation([{ id: "a", role: "assistant", content: "", created_at: new Date(2).toISOString(), metadata: buildMetadata(result[1]) }]);
    expect(restored.deleted).toBe(true);
  });
  it("creates an independent branch through the selected reply, not later questions", () => {
    const branch = branchReplies(messages, "a");
    expect(branch.map((m) => m.content)).toEqual(["Question", "Answer"]);
    expect(branch[0].id).not.toBe("u");
    expect(branch[1].id).not.toBe("a");
    expect(messages).toHaveLength(3);
  });
  it("does not restore a deleted file reply as another message", () => {
    const job = { id: "j", createdAt: new Date(1).toISOString(), updatedAt: new Date(2).toISOString(), status: "completed", artifacts: [] } as any;
    const removed = deleteReply([{ ...messages[1], job }], "a");
    const restored = mergeChatJobs(removed, [job]);
    expect(restored).toHaveLength(1);
    expect(restored[0].deleted).toBe(true);
  });
});