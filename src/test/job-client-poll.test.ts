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
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(["start", "retry"])("uses one %s poll and resolves on its first terminal observation", async (action) => {
    vi.useFakeTimers();
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return respond({ job: view("processing") });
      gets++;
      return respond({ job: view(gets === 2 ? "completed" : "processing") });
    }));
    let final: JobView | undefined;
    const pending = (action === "start" ? runJob("long_context", {}, () => undefined, "job-1") : retryJob("job-1", () => undefined)).then((j) => { final = j; });
    await vi.advanceTimersByTimeAsync(1200);
    expect(gets).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(gets).toBe(1); // former second loop fired at 2000 ms
    expect(final).toBeUndefined();
    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(final?.status).toBe("completed");
    expect(gets).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a terminal poll when a delayed POST returns an older running status", async () => {
    vi.useFakeTimers();
    let resolvePost: (r: Response) => void = () => undefined;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const updates: string[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => init?.method === "POST" ? post : Promise.resolve(respond({ job: view("completed") }))));
    const pending = runJob("long_context", {}, (j) => updates.push(j.status), "job-1");
    await vi.advanceTimersByTimeAsync(1200);
    resolvePost(respond({ job: view("processing") }));
    expect((await pending).status).toBe("completed");
    expect(updates).toEqual(["completed"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap a slow status read with the next poll", async () => {
    vi.useFakeTimers();
    let resolveRead: (r: Response) => void = () => undefined;
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(respond({ job: view("processing") }));
      gets++;
      return new Promise<Response>((resolve) => { resolveRead = resolve; });
    }));
    const pending = runJob("long_context", {}, () => undefined, "job-1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gets).toBe(1);
    resolveRead(respond({ job: view("completed") }));
    expect((await pending).status).toBe("completed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps simultaneous jobs and their terminal results independent", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return respond({ job: { ...view("processing"), id: JSON.parse(String(init.body)).id } });
      const id = url.split("/").at(-1);
      return respond({ job: { ...view(id === "job-a" ? "completed" : "failed"), id } });
    }));
    const a = runJob("long_context", {}, () => undefined, "job-a");
    const b = runJob("long_context", {}, () => undefined, "job-b");
    await vi.advanceTimersByTimeAsync(1200);
    expect(await a).toMatchObject({ id: "job-a", status: "completed" });
    expect(await b).toMatchObject({ id: "job-b", status: "failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

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
