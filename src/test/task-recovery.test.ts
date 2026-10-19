import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
let failOn: string | null = null;
vi.mock("@/lib/jobs/llm.server", () => ({ PLANNING: [], complete: vi.fn(async () => ({ text: JSON.stringify({ steps: [{ tool: "a" }, { tool: "b" }, { tool: "c" }] }) })) }));
vi.mock("@/lib/tools/registry.server", () => {
  const t = (id: string) => ({ id, category: "x", params: "{}" });
  return { TOOL_MAP: new Map(["a", "b", "c"].map((i) => [i, t(i)])), catalogText: () => "", verifyOutput: async () => null };
});
vi.mock("@/lib/tools/tool-schema", () => ({
  executeTool: vi.fn(async (tool: any, ctx: any) => {
    calls.push(tool.id);
    if (failOn === tool.id) throw new Error("crash");
    return { text: `${tool.id} done after ${ctx.lastText || "nothing"}`, files: [{ name: `${tool.id}.txt`, mime: "text/plain", bytes: new TextEncoder().encode(tool.id) }] };
  }),
}));
vi.mock("@/lib/cloud/d1.server", () => ({ d1: vi.fn() }));

import { runAgent } from "@/lib/jobs/agent.server";
import { claimResume, persistCheckpoint, SupersededError } from "@/lib/jobs/resume.server";
import { validateCheckpoint, emptyCheckpoint, serialize, CHECKPOINT_TTL_MS, type AgentCheckpoint } from "@/lib/jobs/checkpoint";

const U = "user-1", J1 = "11111111-1111-1111-1111-111111111111", J2 = "22222222-2222-2222-2222-222222222222";
function fakeJob(id: string) {
  return { id, userId: U, warnings: [] as string[], finished: null as any, step: vi.fn(async () => {}), note: vi.fn(async () => {}), markCurrent: vi.fn(), warn(m: string) { this.warnings.push(m); }, async finish(r: any) { this.finished = r; } } as any;
}
const known = (id: string) => ["a", "b", "c"].includes(id);
const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as any))].map((x) => x.toString(16).padStart(2, "0")).join("");

beforeEach(() => { calls.length = 0; failOn = null; });

async function interruptedRun() {
  const job = fakeJob(J1); let saved: AgentCheckpoint | null = null; const store: any[] = [];
  failOn = "b";
  await expect(runAgent(job, { prompt: "p", files: [] }, async (f) => { const id = `art-${f.name}`; store.push({ id, f }); return { id }; }, { persist: async (cp) => { saved = JSON.parse(serialize(cp)); } })).resolves.toBeUndefined();
  return { job, saved: saved!, store };
}

describe("agent task recovery", () => {
  it("records finished steps and the running step in the checkpoint", async () => {
    const { saved } = await interruptedRun();
    expect(saved.done.map((d) => d.index)).toEqual([0]);
    expect(saved.done[0].artifactIds).toEqual(["art-a.txt"]);
  });

  it("resumes after interruption without repeating finished steps and reports partial → complete honestly", async () => {
    const { job: first, saved, store } = await interruptedRun();
    expect(first.warnings.join()).toMatch(/Step 2 \(b\) failed/); // partial run is not reported as clean success
    calls.length = 0; failOn = null;
    const art = store[0];
    const db = vi.fn(async (sql: string) => sql.startsWith("UPDATE jobs SET resumed_by") ? [{ checkpoint: JSON.stringify(saved) }]
      : [{ id: art.id, name: art.f.name, mime: art.f.mime, sha256: await sha(art.f.bytes), drive_file_id: "d1", expires_at: new Date(Date.now() + 1e6).toISOString() }]);
    const job = fakeJob(J2);
    const resume = await claimResume(job, J1, db as any, async () => art.f.bytes);
    expect(resume?.outputs.map((f) => f.name)).toEqual(["a.txt"]);
    await runAgent(job, { prompt: "p", files: [] }, async (f) => ({ id: `n-${f.name}` }), { resume });
    expect(calls).toEqual(["b", "c"]);
    expect(job.finished.resumedSteps).toBe(1);
    expect(job.finished.steps.map((s: any) => s.tool)).toEqual(["a", "b", "c"]);
    expect(job.finished.steps[1].text).toContain("after a done"); // restored context carried forward
  });

  it("a crash after a step ran but before its checkpoint reruns that step instead of assuming success", async () => {
    const job = fakeJob(J1); let saved: any = null; let n = 0;
    await expect(runAgent(job, { prompt: "p", files: [] }, async () => ({ id: "x" }), { persist: async (cp) => { if (++n === 4) throw new Error("worker died"); saved = JSON.parse(serialize(cp)); } })).rejects.toThrow("worker died");
    // persist #3 marked step a done, #4 (step b running) failed → b must be pending
    expect(saved.done.length).toBe(1); expect(saved.running).toBe(null);
  });

  it("only one worker can claim an interrupted job", async () => {
    let claimed = false;
    const db = vi.fn(async () => { if (claimed) return []; claimed = true; return [{ checkpoint: null }]; });
    await expect(claimResume(fakeJob(J2), J1, db as any)).resolves.toBeNull();
    await expect(claimResume(fakeJob("33333333-3333-3333-3333-333333333333"), J1, db as any)).rejects.toThrow(/already being continued/);
  });

  it("claim query is scoped to the owner and terminal statuses", async () => {
    const db = vi.fn(async () => []);
    await expect(claimResume(fakeJob(J2), J1, db as any)).rejects.toThrow();
    const [sql, params] = (db.mock.calls[0] as any);
    expect(sql).toMatch(/user_id = \?/); expect(sql).toMatch(/status IN \('failed','cancelled','timed_out'\)/);
    expect(params).toEqual([J2, J1, U]);
  });

  it("a superseded worker cannot overwrite the checkpoint", async () => {
    await expect(persistCheckpoint(U, J1, emptyCheckpoint(U, J1, { steps: [{ tool: "a" }] }), (async () => []) as any)).rejects.toBeInstanceOf(SupersededError);
  });

  it("restarts fresh when stored files fail the integrity check", async () => {
    const { saved } = await interruptedRun();
    const db = vi.fn(async (sql: string) => sql.startsWith("UPDATE") ? [{ checkpoint: JSON.stringify(saved) }] : [{ id: "art-a.txt", name: "a.txt", mime: "text/plain", sha256: "bad", drive_file_id: "d", expires_at: new Date(Date.now() + 1e6).toISOString() }]);
    const job = fakeJob(J2);
    expect(await claimResume(job, J1, db as any, async () => new Uint8Array([1]))).toBeNull();
    expect(job.warnings.join()).toMatch(/integrity/);
  });
});

describe("checkpoint validation", () => {
  const base = () => emptyCheckpoint(U, J1, { steps: [{ tool: "a" }, { tool: "b" }] });
  const v = (cp: any, o: any = {}) => validateCheckpoint(cp, { owner: U, jobId: J1, knownTool: known, ...o });
  it("accepts a valid one", () => expect(v(base()).ok).toBe(true));
  it("rejects malformed JSON", () => expect(v("{nope")).toEqual({ ok: false, reason: "malformed" }));
  it("rejects incompatible versions", () => expect(v({ ...base(), v: 99 })).toMatchObject({ reason: "incompatible version" }));
  it("rejects another user's checkpoint", () => expect(v(base(), { owner: "user-2" })).toMatchObject({ reason: "owner mismatch" }));
  it("rejects a checkpoint from another job", () => expect(v(base(), { jobId: J2 })).toMatchObject({ reason: "job mismatch" }));
  it("rejects expired checkpoints", () => expect(v(base(), { now: Date.now() + CHECKPOINT_TTL_MS + 1 })).toMatchObject({ reason: "expired" }));
  it("rejects unknown tools injected into saved state", () => expect(v({ ...base(), plan: { steps: [{ tool: "rm_rf" }] } })).toMatchObject({ reason: "unknown tool" }));
  it("rejects gaps in finished steps", () => expect(v({ ...base(), done: [{ index: 1, result: {}, artifactIds: [] }] })).toMatchObject({ reason: "invalid steps" }));
});
