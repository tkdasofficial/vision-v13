import { describe, expect, it } from "vitest";
import { applyTaskEvent } from "@/lib/ai/task-events";
import { visibleJobStatus } from "@/lib/status-visibility";
import type { JobView } from "@/lib/builder/statuses";

describe("backend-only provider switching", () => {
  it("keeps the actual chat operation and rejects events older than the hidden switch", () => {
    const state = applyTaskEvent(null, { taskId: "t", seq: 1, stage: "reasoning", ts: 0 });
    const next = applyTaskEvent(state, { taskId: "t", seq: 3, stage: "switching_provider", message: "Groq", ts: 1 });
    expect(next).toEqual({ ...state, seq: 3 });
    expect(applyTaskEvent(next, { taskId: "t", seq: 2, stage: "processing", ts: 0 })).toBe(next);
    expect(applyTaskEvent(null, { taskId: "t", seq: 1, stage: "switching_provider", ts: 0 })).toBeNull();
    expect(applyTaskEvent(next, { taskId: "t", seq: 4, stage: "failed", ts: 2 })?.stage).toBe("failed");
  });
  it("excludes switching and its details from current and historical job presentation", () => {
    const job: JobView = { id: "t", type: "agent_task", status: "switching_provider", detail: "Groq", progress: null,
      steps: [{ status: "writing_content", detail: "Report", at: "2026-10-16" }, { status: "switching_provider", detail: "Groq", at: "2026-10-16" }],
      warnings: [], error: null, result: null, artifacts: [], createdAt: "2026-10-16", updatedAt: "2026-10-16" };
    expect(visibleJobStatus(job)).toEqual({ status: "writing_content", detail: "Report", steps: [job.steps[0]] });
    expect(visibleJobStatus({ ...job, steps: [] })).toEqual({ status: "processing", detail: undefined, steps: [] });
    expect(visibleJobStatus({ ...job, status: "completed", detail: "Saved" }).status).toBe("completed");
  });
});