import { describe, expect, it } from "vitest";
import { branchReplies, deleteReply, canUseReplyActions, replyText, speechChunks } from "@/lib/reply-actions";
import { buildMetadata, rowsToConversation } from "@/context/ChatHistoryContext";
import { mergeChatJobs } from "@/lib/builder/job-recovery";
import type { ChatMessage } from "@/lib/types";

const messages: ChatMessage[] = [
  { id: "u", role: "user", content: "Question", timestamp: new Date(1) },
  { id: "a", role: "assistant", content: "Answer", timestamp: new Date(2) },
  { id: "u2", role: "user", content: "Later", timestamp: new Date(3) },
];
describe("reply actions", () => {
  it("allows all actions only for a successful fully displayed reply", () => {
    expect(canUseReplyActions(messages[1])).toBe(true);
    expect(canUseReplyActions(messages[1], false)).toBe(false);
    expect(canUseReplyActions({ ...messages[1], responsePending: true })).toBe(false);
    expect(canUseReplyActions({ ...messages[1], content: "" })).toBe(false);
    expect(canUseReplyActions({ ...messages[1], activity: { seconds: 1, steps: [], failed: true } })).toBe(false);
  });
  it.each(["thinking", "generating", "validating", "failed"] as const)("hides actions for %s Deep replies", (stage) => {
    expect(canUseReplyActions({ ...messages[1], deep: { stage } })).toBe(false);
  });
  it("allows completed Deep replies", () => expect(canUseReplyActions({ ...messages[1], deep: { stage: "done" } })).toBe(true));
  it.each(["queued", "running", "saving", "failed", "cancelled", "timed_out"] as const)("hides actions for %s jobs", (status) => {
    expect(canUseReplyActions({ ...messages[1], job: { status, artifacts: [] } as any })).toBe(false);
  });
  it("copies the full completed story result, not a placeholder or only filenames", () => {
    const m = { ...messages[1], content: "", job: { type: "runtime_task", status: "completed", result: { operation: "story_generate", content: "Full story, prompts and dialogues." }, artifacts: [] } as any };
    expect(canUseReplyActions(m)).toBe(true);
    expect(replyText(m)).toBe("Full story, prompts and dialogues.");
  });
  it("does not expose hidden file contents through Copy", () => {
    expect(replyText({ ...messages[1], content: "Here's your file.", job: { type: "code_export", status: "completed", result: { content: "private file contents" }, artifacts: [{ name: "code.py" }] } as any })).toBe("Here's your file.\ncode.py");
  });
  it("keeps all long speech content in bounded utterances", () => {
    const text = "word ".repeat(300);
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((s) => s.length <= 220)).toBe(true);
    expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
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