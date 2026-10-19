import { describe, it, expect, vi } from "vitest";

const existing = { id: "job-1", status: "done" };
vi.mock("@/lib/jobs/jobs.server", () => ({
  getJob: vi.fn(async (_u: string, id: string) => (id === "job-1" ? existing : null)),
  createJob: vi.fn(async () => { throw new Error("stop after create"); }),
  safeError: (e: any) => String(e?.message ?? e),
}));

describe("job idempotency", () => {
  it("returns the existing job for a replayed id without creating or running it again", async () => {
    const jobs = await import("@/lib/jobs/jobs.server");
    const { startJob } = await import("@/lib/jobs/dispatch.server");
    expect(await startJob("u1", "job-1", "code_export", {})).toBe(existing);
    expect(jobs.createJob).not.toHaveBeenCalled();
  });
  it("runs an intentional repeat (new id, same text) as a new job", async () => {
    const jobs = await import("@/lib/jobs/jobs.server");
    await expect(startJob2()).rejects.toThrow(/stop after create/);
    expect(jobs.createJob).toHaveBeenCalledTimes(1);
    async function startJob2() { const { startJob } = await import("@/lib/jobs/dispatch.server"); return startJob("u1", "job-2", "code_export", {}); }
  });
  it("explicit retries (attempt > 1) never short-circuit", async () => {
    const jobs = await import("@/lib/jobs/jobs.server");
    const { startJob } = await import("@/lib/jobs/dispatch.server");
    await expect(startJob("u1", "job-1", "code_export", {}, 2)).rejects.toThrow();
    expect(jobs.createJob).toHaveBeenCalledTimes(2);
  });
});
