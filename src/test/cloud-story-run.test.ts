// Regression tests for the Cloudflare story run: a below-90 scene must be regenerated in its
// own slot (it was wrongly rejected as "slot unavailable"), and a spent run budget must hand
// off to the next queue run instead of hanging or failing, resuming finished slots.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "./helpers/fake-slot-db";

const h = vi.hoisted(() => ({ db: null as any, d1Calls: [] as { sql: string; params: unknown[] }[] }));

vi.mock("@/lib/sandbox/db.server", () => ({ sandboxDb: (sql: string, params?: unknown[]) => h.db(sql, params), sandboxReady: () => true }));
vi.mock("@/lib/cloud/d1.server", () => ({ d1: async (sql: string, params: unknown[] = []) => { h.d1Calls.push({ sql, params }); return []; } }));
vi.mock("@/lib/jobs/artifact-store.server", () => ({ putD1Artifact: async () => ({ key: "k", chunks: 1 }) }));

import { runCloudStoryJob } from "@/lib/runtime/cloud-story.server";
import { JobRun } from "@/lib/jobs/jobs.server";
import { resetSlotSetup } from "@/lib/sandbox/slots.server";

const PROMPT = "Create a horror story in exactly 2 scenes. Give me the full story plus, for each scene, a visual prompt and dialogue. Each scene must contain 25 to 30 words of dialogue. Keep one fixed background.";
const model = { provider: "nvidia" as const, model: "m", label: "m" };
const ok = (text: string) => ({ ok: true as const, text, finishReason: "stop", model });
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ");
const scene = (n: number, w: number) => `## Scene ${n}\n\n### Visual Prompt\nThe same dim cabin interior, dust in the air.\n\n### Dialogue\nMARA: ${words(w)}\n`;
const STORY = "Mara arrives at the cabin. ".repeat(60);

function scripted(badFirst: Set<number>) {
  const seen = new Map<number, number>();
  const calls: string[] = [];
  const call = async (messages: any[]) => {
    const sys = String(messages[0].content);
    const user = String(messages[1]?.content ?? "");
    if (sys.startsWith("Create a master blueprint")) { calls.push("blueprint"); return ok("Setting: one cabin. Character: Mara, grey coat."); }
    if (sys.startsWith("Write the complete story")) { calls.push("story"); return ok(STORY); }
    const n = Number(user.match(/Write scene (\d+)/)?.[1] ?? 0);
    const tries = (seen.get(n) ?? 0) + 1;
    seen.set(n, tries);
    calls.push(`scene${n}#${tries}`);
    return ok(scene(n, badFirst.has(n) && tries === 1 ? 8 : 27));
  };
  return { call, calls };
}

beforeEach(() => { h.db = fakeDb().db; h.d1Calls = []; resetSlotSetup(); });

describe("runCloudStoryJob", () => {
  it("regenerates a below-90 scene in its own slot instead of failing it", async () => {
    const { call, calls } = scripted(new Set([1]));
    const out = await runCloudStoryJob(new JobRun("job-regen-1", "user-1"), PROMPT, { call });
    expect(out).toBe("done");
    expect(calls).toContain("scene1#2");
    const delivered = h.d1Calls.find((c) => c.sql.includes("status = 'uploaded'"));
    expect(delivered).toBeTruthy();
    expect(JSON.parse(String(delivered!.params[5]))).toMatchObject({ scenes: 2, failedScenes: 0 });
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(false);
  });

  it("yields when the run budget is spent, without failing the job or its slots", async () => {
    const { call, calls } = scripted(new Set());
    const out = await runCloudStoryJob(new JobRun("job-yield-1", "user-1"), PROMPT, { call, deadlineAt: Date.now() - 1 });
    expect(out).toBe("yield");
    expect(calls).toEqual([]);
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(false);
  });

  it("resumes after a yield without regenerating finished work", async () => {
    const job = new JobRun("job-resume-1", "user-1");
    const first = scripted(new Set());
    const realNow = Date.now.bind(Date);
    const start = realNow();
    // The run budget expires right after the blueprint call returns.
    const expireAfterBlueprint = async (m: any[]) => {
      const r = await first.call(m);
      vi.spyOn(Date, "now").mockImplementation(() => start + 60_000);
      return r;
    };
    const out1 = await runCloudStoryJob(job, PROMPT, { call: expireAfterBlueprint as any, deadlineAt: start + 30_000 });
    vi.restoreAllMocks();
    expect(out1).toBe("yield");
    expect(first.calls).toEqual(["blueprint"]);
    const second = scripted(new Set());
    const out2 = await runCloudStoryJob(job, PROMPT, { call: second.call });
    expect(out2).toBe("done");
    expect(second.calls).not.toContain("blueprint");
    expect(second.calls[0]).toBe("story");
  });

  it("stays far below Cloudflare's per-run database call limit (slot setup runs once)", async () => {
    const fake = fakeDb();
    const seen: string[] = [];
    h.db = (sql: string, params?: unknown[]) => { seen.push(sql); return fake.db(sql, params); };
    const five = PROMPT.replace("exactly 2 scenes", "exactly 5 scenes");
    const { call } = scripted(new Set([1, 3]));
    const out = await runCloudStoryJob(new JobRun("job-limit-1", "user-1"), five, { call });
    expect(out).toBe("done");
    expect(seen.filter((q) => q.startsWith("INSERT OR IGNORE INTO generation_slots")).length).toBe(100);
    expect(seen.length + h.d1Calls.length).toBeLessThan(400);
  });

  it("sends a heartbeat before every provider call", async () => {
    const { call, calls } = scripted(new Set());
    await runCloudStoryJob(new JobRun("job-heartbeat-1", "user-1"), PROMPT, { call });
    const beats = h.d1Calls.filter((c) => c.sql.startsWith("UPDATE runtime_jobs SET updated_at = ?"));
    expect(beats.length).toBe(calls.length);
  });
});

describe("full story format (slot 2)", () => {
  it("regenerates a scene-formatted story once and delivers the prose version", async () => {
    let storyCalls = 0;
    const base = scripted(new Set());
    const call = async (messages: any[]) => {
      if (String(messages[0].content).startsWith("Write the complete story")) {
        storyCalls++;
        return ok(storyCalls === 1 ? scene(1, 27) : STORY);
      }
      return base.call(messages);
    };
    const out = await runCloudStoryJob(new JobRun("job-story-fmt-1", "user-1"), PROMPT, { call });
    expect(out).toBe("done");
    expect(storyCalls).toBe(2);
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'uploaded'"))).toBe(true);
  });

  it("fails honestly when the story is still scene-formatted after one regeneration", async () => {
    const base = scripted(new Set());
    const call = async (messages: any[]) => String(messages[0].content).startsWith("Write the complete story") ? ok(scene(1, 27)) : base.call(messages);
    await runCloudStoryJob(new JobRun("job-story-fmt-2", "user-1"), PROMPT, { call });
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'uploaded'"))).toBe(false);
    expect(h.d1Calls.some((c) => c.sql.includes("SET status = 'failed'"))).toBe(true);
  });
});

describe("story run timing limits", () => {
  it("never fails a job as stalled before the queue could redeliver it", async () => {
    const { STORY_STALE_MS, STORY_RUN_BUDGET_MS } = await import("@/lib/runtime/runtime.server");
    const QUEUE_RUN_LIMIT_MS = 15 * 60_000;
    expect(STORY_RUN_BUDGET_MS).toBeLessThan(QUEUE_RUN_LIMIT_MS);
    expect(STORY_STALE_MS).toBeGreaterThan(QUEUE_RUN_LIMIT_MS);
  });
});

describe("Workers Free plan: one provider call per queue run", () => {
  it("finishes a job across many single-call runs without repeating finished work", async () => {
    const { STORY_CALLS_PER_RUN } = await import("@/lib/runtime/runtime.server");
    expect(STORY_CALLS_PER_RUN).toBe(1);
    const job = new JobRun("job-onecall-1", "user-1");
    const s = scripted(new Set([2]));
    let out: "done" | "yield" | "wait" = "yield";
    let runs = 0;
    while (out === "yield" && runs < 30) { runs++; out = await runCloudStoryJob(job, PROMPT, { call: s.call, maxCalls: 1 }); }
    expect(out).toBe("done");
    // blueprint, story, scene1, scene2 draft, scene2 regeneration — each exactly once.
    expect(s.calls).toEqual(["blueprint", "story", "scene1#1", "scene2#1", "scene2#2"]);
    expect(runs).toBe(s.calls.length);
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'uploaded'"))).toBe(true);
  });
});

describe("scene repair keeps the best version", () => {
  it("accepts a scene whose only flaw is a missing scene heading", async () => {
    const { normalizeScene, scoreScene } = await import("@/lib/runtime/cloud-story");
    const body = scene(1, 27).replace("## Scene 1\n\n", "");
    expect(scoreScene(normalizeScene(body, 0), 0, PROMPT).score).toBe(100);
  });

  it("never lets a worse rewrite replace a better draft", async () => {
    const base = scripted(new Set());
    let s1 = 0;
    const call = async (messages: any[]) => {
      const user = String(messages[1]?.content ?? "");
      if (/Write scene 1 of/.test(user)) { s1++; return ok(scene(1, 8)); } // short dialogue: one issue
      if (String(messages[0].content).startsWith("Fix Prompt") && /Scene 1/.test(user)) return ok(s1++ === 2 ? "| table | only |" : scene(1, 27));
      return base.call(messages);
    };
    const out = await runCloudStoryJob(new JobRun("job-best-1", "user-1"), PROMPT, { call });
    expect(out).toBe("done");
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'uploaded'"))).toBe(true);
  });
});

describe("one story at a time", () => {
  it("makes a second story wait (not fail) while another holds the shared slots, then run once they are free", async () => {
    const a = new JobRun("job-first-01", "user-1");
    const b = new JobRun("job-second-1", "user-2");
    const s = scripted(new Set());
    expect(await runCloudStoryJob(a, PROMPT, { call: s.call, maxCalls: 1 })).toBe("yield");
    expect(await runCloudStoryJob(b, PROMPT, { call: s.call })).toBe("wait");
    expect(h.d1Calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(false);
    expect(await runCloudStoryJob(a, PROMPT, { call: s.call })).toBe("done");
    const { releaseJobSlots } = await import("@/lib/sandbox/slots.server");
    await releaseJobSlots("user-1", "job-first-01");
    expect(await runCloudStoryJob(b, PROMPT, { call: s.call })).toBe("done");
  });
});
