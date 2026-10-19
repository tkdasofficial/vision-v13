// Activity history must persist across reloads: buildMetadata writes it, rowsToConversation restores it.
import { describe, expect, it } from "vitest";
import { buildMetadata, rowsToConversation } from "@/context/ChatHistoryContext";

describe("activity record persistence", () => {
  it("preserves measured normal-task duration even without stage events", () => {
    const metadata = buildMetadata({ id: "normal", role: "assistant", content: "Answer", timestamp: new Date(), activity: { seconds: 8, steps: [] } });
    const [restored] = rowsToConversation([{ id: "normal", role: "assistant", content: "Answer", created_at: new Date().toISOString(), metadata }]);
    expect(restored.activity).toEqual({ seconds: 8, steps: [] });
  });
  it("preserves a failed normal task's measured duration and recorded cause", () => {
    const metadata = buildMetadata({ id: "normal-failed", role: "assistant", content: "Error", timestamp: new Date(), activity: { seconds: 19, steps: ["Validating"], failed: true, detail: "Validation interrupted" } });
    const [restored] = rowsToConversation([{ id: "normal-failed", role: "assistant", content: "Error", created_at: new Date().toISOString(), metadata }]);
    expect(restored.activity).toEqual({ seconds: 19, steps: ["Validating"], failed: true, detail: "Validation interrupted" });
  });
  it("keeps failed task time and failed step after reload", () => {
    const metadata = buildMetadata({ id: "failed", role: "assistant", content: "Stopped", timestamp: new Date(), deep: { stage: "failed", seconds: 23, detail: "Validating: missing canonical prop" } });
    const [restored] = rowsToConversation([{ id: "failed", role: "assistant", content: "Stopped", created_at: new Date().toISOString(), metadata }]);
    expect(restored.deep).toEqual({ stage: "failed", seconds: 23, detail: "Validating: missing canonical prop" });
  });
  it("saves real seconds and steps into message metadata", () => {
    const meta = buildMetadata({ id: "1", role: "assistant", content: "Hi", timestamp: new Date(), activity: { seconds: 12, steps: ["Thinking", "Searching", "Writing"] } } as any);
    expect(meta.activity).toEqual({ seconds: 12, steps: ["Thinking", "Searching", "Writing"] });
  });
  it("restores the activity record from a saved row", () => {
    const rows = [{
      id: "r1", role: "assistant", content: "Done.", created_at: new Date().toISOString(),
      metadata: { activity: { seconds: 12, steps: ["Thinking", "Writing"] } },
    }];
    const [msg] = rowsToConversation(rows);
    expect(msg.activity).toEqual({ seconds: 12, steps: ["Thinking", "Writing"] });
  });
  it("drops malformed or empty activity records instead of fabricating", () => {
    const rows = [{ id: "r1", role: "assistant", content: "x", created_at: new Date().toISOString(), metadata: { activity: { seconds: "many", steps: [] } } }];
    expect(rowsToConversation(rows)[0].activity).toBeUndefined();
  });
  it("round-trips through save and load unchanged", () => {
    const original = { seconds: 7, steps: ["Thinking", "Validating"] };
    const meta = buildMetadata({ id: "1", role: "assistant", content: "x", timestamp: new Date(), activity: original } as any);
    const [msg] = rowsToConversation([{ id: "r1", role: "assistant", content: "x", created_at: new Date().toISOString(), metadata: meta }]);
    expect(msg.activity).toEqual(original);
  });
});
