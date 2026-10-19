import { describe, expect, it } from "vitest";
import { followJob, mergeChatJobs } from "@/lib/builder/job-recovery";
import type { JobView } from "@/lib/builder/statuses";
const job = (status: JobView["status"]): JobView => ({ id: "saved-job", type: "long_context", status, detail: "", progress: null, steps: [], warnings: [], error: null, result: null, createdAt: "2026-10-17T10:00:00Z", updatedAt: "2026-10-17T10:00:05Z", artifacts: status === "completed" ? [{ id: "saved-file", name: "Business_Performance_Analysis.xlsx", size: 73000, kind: "file" }] : [] });
describe("saved account file results", () => {
  it("joins a saved prompt-series reply and its job into one inline result", () => {
    const completed = { ...job("completed"), type: "runtime_task" as const, result: { content: "# Scene 1\nThe locked door." } };
    const saved = { id: `job-${completed.id}`, role: "assistant" as const, content: completed.result.content, timestamp: new Date(completed.updatedAt) };
    const restored = mergeChatJobs([saved], [completed]);
    expect(restored).toHaveLength(1);
    expect(restored[0].content).toBe("");
    expect(restored[0].job?.result.content).toBe("# Scene 1\nThe locked door.");
    expect(mergeChatJobs(restored, [completed])).toHaveLength(1);
  });
  it("keeps durable text when the job has no inline result", () => {
    const completed = job("completed");
    const restored = mergeChatJobs([{ id: `job-${completed.id}`, role: "assistant", content: "Full saved story", timestamp: new Date(completed.updatedAt) }], [completed]);
    expect(restored).toHaveLength(1);
    expect(restored[0].content).toBe("Full saved story");
  });
  it("does not combine unrelated identical replies", () => {
    const completed = { ...job("completed"), result: { content: "Same text" } };
    expect(mergeChatJobs([{ id: "other-reply", role: "assistant", content: "Same text", timestamp: new Date() }], [completed])).toHaveLength(2);
  });
  it("restores the registered file exactly once when the chat is reopened", () => {
    const restored = mergeChatJobs([], [job("completed")]);
    const again = mergeChatJobs(restored, [job("completed")]);
    expect(again).toHaveLength(1);
    expect(again[0].job?.artifacts[0]).toMatchObject({ id: "saved-file", name: "Business_Performance_Analysis.xlsx" });
  });
  it("keeps following accepted work after a failed status read until the saved file arrives", async () => {
    let reads = 0;
    const seen: JobView[] = [];
    await followJob("saved-job", async () => { reads++; if (reads === 1) throw new Error("offline"); return job(reads === 2 ? "generating" : "completed"); }, (j) => seen.push(j), () => false, async () => {});
    expect(reads).toBe(3);
    expect(seen.map((j) => j.status)).toEqual(["generating", "completed"]);
    expect(seen[1].artifacts[0].id).toBe("saved-file");
  });
  it("leaving the view stops reads without cancelling the server task", async () => {
    let stopped = false, reads = 0;
    await followJob("saved-job", async () => { reads++; return job("generating"); }, () => {}, () => stopped, async () => { stopped = true; });
    expect(reads).toBe(1);
    expect(mergeChatJobs([], [job("completed")])[0].job?.status).toBe("completed");
  });
});