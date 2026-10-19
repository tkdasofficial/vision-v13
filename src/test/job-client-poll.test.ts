// Regression: long tasks return from POST /api/jobs while still "running" (the server detaches them
// via waitUntil). The client must keep polling until a terminal state instead of freezing on "running".
import { afterEach, describe, expect, it, vi } from "vitest";
import { runJob, retryJob, listJobs } from "@/lib/builder/jobs-client";
import type { JobView } from "@/lib/builder/statuses";

const view = (status: string): JobView => ({
  id: "job-1", type: "long_context", status: status as any, detail: "", progress: null,
  steps: [], warnings: [], error: null, result: null, artifacts: [], sessionId: null,
  createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z",
});

const respond = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("runJob polling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps polling when the start response is still running, until the job completes", async () => {
    const updates: string[] = [];
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
      if (init?.method === "POST") return respond({ job: view("processing") });
      gets++;
      return respond({ job: view(gets >= 2 ? "completed" : "processing") });
    }));
    const final = await runJob("long_context", { input: { prompt: "x" } }, (j) => updates.push(j.status), "job-1");
    expect(final.status).toBe("completed");
    expect(updates[0]).toBe("processing");
    expect(updates[updates.length - 1]).toBe("completed");
    expect(gets).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("stops immediately when the start response is already terminal", async () => {
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
      if (init?.method === "POST") return respond({ job: view("completed") });
      gets++;
      return respond({ job: view("completed") });
    }));
    const final = await runJob("long_context", { input: { prompt: "x" } }, () => undefined, "job-1");
    expect(final.status).toBe("completed");
    expect(gets).toBe(0);
  });

  it.each(["start", "retry"])("keeps the accepted %s task after a temporary status-read error", async (action) => {
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return respond({ job: view("processing") });
      gets++;
      if (gets <= 2) throw new Error("offline");
      return respond({ job: view("completed") });
    }));
    const updates: string[] = [];
    const update = (j: JobView) => updates.push(j.status);
    const final = action === "start" ? await runJob("long_context", { input: {} }, update, "job-1") : await retryJob("job-1", update);
    expect(final.status).toBe("completed");
    expect(updates.at(-1)).toBe("completed");
    expect(gets).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("rejects malformed saved-result lists instead of treating them as empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({})));
    await expect(listJobs("saved-chat")).rejects.toThrow("Saved results could not be read");
  });

  it("preserves the server's sign-in error for failed saved-result reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Please sign in." }), { status: 401 })));
    await expect(listJobs("saved-chat")).rejects.toThrow("Please sign in.");
  });
});
