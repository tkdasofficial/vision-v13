import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as string[], rt: {} as Record<string, unknown> }));
vi.mock("@/lib/cloud/d1.server", () => ({ d1: async (sql: string) => {
  h.calls.push(sql);
  return sql.startsWith("SELECT * FROM runtime_jobs") ? [h.rt] : [];
} }));

import { syncRuntimeJob } from "@/lib/runtime/runtime.server";

describe("queued story handoff", () => {
  it("does not replace recorded Queued with the previous run's stage on poll", async () => {
    const now = new Date().toISOString();
    h.calls = [];
    h.rt = { job_id: "job", user_id: "owner", operation: "story_generate", status: "running", stage: "writing_scene_1", updated_at: now, deadline: new Date(Date.now() + 60_000).toISOString() };
    const changed = await syncRuntimeJob({ id: "job", user_id: "owner", type: "runtime_task", status: "queued", steps: JSON.stringify([{ status: "queued", detail: "Waiting for the next story worker run", at: now }]), updated_at: now });
    expect(changed).toBe(false);
    expect(h.calls.filter((sql) => sql.startsWith("UPDATE jobs SET status"))).toEqual([]);
  });
});