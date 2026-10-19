// Long Context Generation: pure pipeline logic, store behavior (in-memory D1 double),
// and runner orchestration with a mocked model call.
import { describe, expect, it, vi } from "vitest";
import { assemble, buildChunkContext, buildPlan, checksum, chunkMessages, scheduleWaves, summarize, validateAssembly } from "@/lib/sandbox/generation";
import * as store from "@/lib/sandbox/store.server";
import { cancelJob, retryJob, runJob } from "@/lib/sandbox/runner.server";

// In-memory D1 double implementing the SQL surface used by store.server.ts.
function memDb() {
  const jobs = new Map<string, any>();
  const plans: any[] = [];
  const chunks = new Map<string, any>(); // key jobId:seq
  const outputs: any[] = [];
  const events: any[] = [];
  const db = async (sql: string, p: unknown[] = []): Promise<any[]> => {
    const s = sql.replace(/\s+/g, " ").trim();
    const now = Date.now();
    const match = (re: RegExp) => s.match(re);
    if (s.startsWith("SELECT * FROM generation_jobs WHERE user_id")) return [...jobs.values()].filter((j) => j.user_id === p[0] && j.id === p[1]);
    if (s.startsWith("SELECT * FROM generation_jobs WHERE id")) { const j = jobs.get(p[0] as string); return j && j.user_id === p[1] ? [j] : []; }
    if (s.startsWith("INSERT OR IGNORE INTO generation_jobs")) {
      if (jobs.has(p[0] as string)) return [];
      jobs.set(p[0] as string, { id: p[0], user_id: p[1], instructions: p[2], model_config: p[3], settings: p[4], status: "pending", total_chunks: 0, completed_chunks: 0, error: null, created_at: p[5], updated_at: p[6] });
      return [];
    }
    if (s.startsWith("UPDATE generation_jobs SET status")) {
      const j = jobs.get(p[p.length - (s.includes("AND status IN") ? 2 + (s.match(/\?/g)!.length - 0) : 2)] as string) ?? jobs.get(p.find((x, i) => typeof x === "string" && jobs.has(x as string) && i > 1) as string);
      // simpler: params are [...sets, jobId, userId, ...from]
      const jobId = p.find((x) => typeof x === "string" && jobs.has(x as string)) as string;
      const job = jobs.get(jobId);
      if (!job || job.user_id !== p[p.indexOf(jobId) + 1]) return [];
      if (s.includes("AND status IN")) {
        const from = p.slice(p.indexOf(jobId) + 2) as string[];
        if (!from.includes(job.status)) return [];
      }
      job.status = p[0]; job.updated_at = p[1];
      if (s.includes("error = ?")) job.error = p[2];
      if (s.includes("total_chunks = ?")) job.total_chunks = p[s.includes("error = ?") ? 3 : 2];
      return [ { id: jobId } ];
    }
    if (s.startsWith("UPDATE generation_plans SET status = 'superseded'")) { plans.forEach((pl) => { if (pl.job_id === p[0]) pl.status = "superseded"; }); return []; }
    if (s.startsWith("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM generation_plans")) return [{ v: plans.filter((pl) => pl.job_id === p[0]).length + 1 }];
    if (s.startsWith("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM generation_outputs")) return [{ v: outputs.filter((o) => o.job_id === p[0]).length + 1 }];
    if (s.startsWith("INSERT INTO generation_plans")) { plans.push({ job_id: p[0], version: p[1], outline: p[2], chunk_structure: p[3], dependencies: p[4], context_policy: p[5], status: "active" }); return []; }
    if (s.startsWith("INSERT OR IGNORE INTO generation_chunks")) {
      const key = `${p[1]}:${p[2]}`;
      if (!chunks.has(key)) chunks.set(key, { id: p[0], job_id: p[1], seq: p[2], section_id: p[3], instructions: p[4], content: null, status: "pending", attempts: 0, tokens: 0, checksum: null, error: null, created_at: now, updated_at: now });
      return [];
    }
    if (s.startsWith("UPDATE generation_chunks SET section_id")) return [];
    if (s.startsWith("INSERT INTO generation_context")) return [];
    if (s.startsWith("SELECT p.* FROM generation_plans")) { const pl = plans.filter((x) => x.job_id === p[0] && x.status === "active").pop(); return pl && jobs.get(p[0] as string)?.user_id === p[1] ? [pl] : []; }
    if (s.startsWith("SELECT c.* FROM generation_chunks")) return [...chunks.values()].filter((c) => c.job_id === p[0] && jobs.get(p[0] as string)?.user_id === p[1]).sort((a, b) => a.seq - b.seq);
    if (s.startsWith("UPDATE generation_chunks SET status = 'generating'")) {
      const c = chunks.get(`${p[1]}:${p[2]}`);
      if (!c || !["pending", "failed", "retrying"].includes(c.status)) return [];
      c.status = "generating"; c.attempts++; c.updated_at = now;
      return [c];
    }
    if (s.startsWith("UPDATE generation_chunks SET content")) {
      const c = chunks.get(`${p[4]}:${p[5]}`);
      if (!c || !["generating", "validating", "retrying"].includes(c.status)) return [];
      c.content = p[0]; c.status = "completed"; c.tokens = p[1]; c.checksum = p[2]; c.error = null;
      return [{ id: c.id }];
    }
    if (s.startsWith("UPDATE generation_jobs SET completed_chunks")) {
      const j = jobs.get(p[2] as string);
      if (j) j.completed_chunks = [...chunks.values()].filter((c) => c.job_id === p[0] && c.status === "completed").length;
      return [];
    }
    if (s.startsWith("UPDATE generation_chunks SET status = 'failed'")) {
      const c = chunks.get(`${p[2]}:${p[3]}`);
      if (!c || !["generating", "validating", "retrying", "pending"].includes(c.status)) return [];
      c.status = "failed"; c.error = p[0];
      return [{ id: c.id }];
    }
    if (s.startsWith("UPDATE generation_chunks SET status = 'retrying'")) {
      [...chunks.values()].forEach((c) => { if (c.job_id === p[1] && (p.length === 4 ? c.seq === p[3] && c.status === "failed" : ["failed", "generating", "validating"].includes(c.status))) c.status = "retrying"; });
      return [];
    }
    if (s.startsWith("INSERT INTO generation_outputs")) { outputs.push({ job_id: p[0], version: p[1], content: p[2], validation_status: p[3], validation_detail: p[4] }); return []; }
    if (s.startsWith("SELECT o.* FROM generation_outputs")) return outputs.filter((o) => o.job_id === p[0] && jobs.get(p[0] as string)?.user_id === p[1]).slice(-1);
    if (s.startsWith("INSERT INTO generation_events")) { events.push({ job_id: p[0], chunk_id: p[1], event_type: p[2], status: p[3] }); return []; }
    if (s.startsWith("SELECT e.id")) return events.filter((e) => e.job_id === p[0]);
    throw new Error(`unhandled SQL: ${s}`);
  };
  return { db: db as any, jobs, chunks, plans, outputs, events };
}

const ok = (text: string) => ({ ok: true as const, text, finishReason: "stop", model: { provider: "test", model: "t", label: "t" } });
const fail = (reason: string) => ({ ok: false as const, status: 503, reason });

describe("generation plan", () => {
  it("builds a single-chunk plan when there is no outline", () => {
    const plan = buildPlan("Write a story", []);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].dependsOn).toEqual([]);
  });

  it("schedules independent chunks in parallel waves and dependencies sequentially", () => {
    const plan = buildPlan("Write a report", ["Intro", "Data", "Continue with analysis", "Finally, conclusions"]);
    expect(plan.chunks[2].dependsOn).toEqual([1]);
    expect(plan.chunks[3].dependsOn).toEqual([2]);
    const waves = scheduleWaves(plan.chunks);
    expect(waves[0].sort()).toEqual([0, 1]);
    expect(waves).toHaveLength(3);
  });

  it("rejects dependency cycles", () => {
    const chunks = [
      { seq: 0, sectionId: "a", title: "a", instructions: "", dependsOn: [1], tokenBudget: 1 },
      { seq: 1, sectionId: "b", title: "b", instructions: "", dependsOn: [0], tokenBudget: 1 },
    ];
    expect(() => scheduleWaves(chunks)).toThrow(/cycle/);
  });
  it("rejects silent outline truncation", () => {
    expect(() => buildPlan("Write every section", ["One", "Two", "Three"], { maxChunks: 2 })).toThrow("3 sections");
  });
});

describe("context management", () => {
  it("keeps dependencies verbatim and summarizes other previous sections", () => {
    const plan = buildPlan("Write", ["A", "B", "Continue with C"]);
    const long = "word ".repeat(200);
    const ctx = buildChunkContext({
      instructions: "Write", outline: plan.outline, chunk: plan.chunks[2],
      completed: [
        { seq: 0, sectionId: "s0", title: "A", content: long },
        { seq: 1, sectionId: "s1", title: "B", content: long },
      ],
      policy: plan.contextPolicy,
    });
    const dep = ctx.previous.find((p) => p.sectionId === "s1");
    const other = ctx.previous.find((p) => p.sectionId === "s0");
    expect(dep?.summary).toBe(false);
    expect(dep?.content).toBe(long);
    expect(other?.summary).toBe(true);
    expect(other!.content.length).toBeLessThan(long.length);
    expect(ctx.global).toBe("Write");
  });

  it("renders bounded messages for the model", () => {
    const plan = buildPlan("Write", ["A", "B"]);
    const ctx = buildChunkContext({ instructions: "Write", outline: plan.outline, chunk: plan.chunks[1], completed: [], policy: plan.contextPolicy });
    const msgs = chunkMessages(ctx, 100) as any[];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toContain("100 tokens");
  });

  it("summarize trims to the limit", () => {
    expect(summarize("x".repeat(1000)).length).toBeLessThanOrEqual(401);
  });
});

describe("assembly validation", () => {
  const c = (seq: number, content: string | null, status = "completed") => ({ seq, content, status, checksum: content ? checksum(content) : null });
  it("accepts a complete ordered set", () => {
    expect(validateAssembly([c(0, "a"), c(1, "b")]).ok).toBe(true);
  });
  it("rejects missing, incomplete and duplicated chunks", () => {
    expect((validateAssembly([c(1, "a")]) as any).problems.join()).toMatch(/gap/);
    expect((validateAssembly([c(0, null), c(1, "b")]) as any).problems.join()).toMatch(/missing/);
    expect((validateAssembly([c(0, "a"), c(1, "a")]) as any).problems.join()).toMatch(/duplicates/);
  });
  it("assembles in sequence order", () => {
    expect(assemble([{ seq: 1, content: "b" }, { seq: 0, content: "a" }])).toBe("a\n\nb");
  });
  it("rejects missing trailing sections, empty output and corrupted saved content", () => {
    expect(validateAssembly([c(0, "a")], 2).ok).toBe(false);
    expect(validateAssembly([], 2).ok).toBe(false);
    expect(validateAssembly([{ ...c(0, "original"), content: "corrupted" }], 1).ok).toBe(false);
  });
});

describe("runner with mocked store and model", () => {
  it("completes a multi-chunk job, saving output and events", async () => {
    const { db, outputs } = memDb();
    const job = await store.createJob("u1", { instructions: "Write a short guide" }, db);
    const call = vi.fn(async (msgs: any[]) => {
      const user = msgs[1].content as string;
      if (user.includes("Write a short guide") && !user.includes("Your task")) return ok(JSON.stringify(["Start", "Middle", "End"]));
      const m = user.match(/Write the section \"([^\"]+)/); return ok(`content for ${(m?.[1] ?? "start").toLowerCase()}`);
    });
    const res = await runJob("u1", job.id, { db, call: call as any });
    expect(outputs).toHaveLength(1);
    expect(outputs[0].validation_status).toBe("valid");
    expect(outputs[0].content).toContain("content for start");
    expect(outputs[0].content).toContain("content for end");
  });

  it("is idempotent: the same requestId returns the existing job", async () => {
    const { db, jobs } = memDb();
    const a = await store.createJob("u1", { instructions: "X do it", requestId: "req-12345" }, db);
    const b = await store.createJob("u1", { instructions: "X do it", requestId: "req-12345" }, db);
    expect(b.id).toBe(a.id);
    expect(jobs.size).toBe(1);
  });

  it("enforces ownership on reads", async () => {
    const { db } = memDb();
    const job = await store.createJob("u1", { instructions: "secret work" }, db);
    expect(await store.getJob("u2", job.id, db)).toBeNull();
    expect(await store.listChunks("u2", job.id, db)).toEqual([]);
  });

  it("retries failed chunks without regenerating completed ones", async () => {
    const { db, chunks } = memDb();
    const job = await store.createJob("u1", { instructions: "Write a short guide" }, db);
    let calls = 0;
    const call = vi.fn(async (msgs: any[]) => {
      const user = msgs[1].content as string;
      if (!user.includes("Your task")) return ok(JSON.stringify(["Start", "Middle", "End"]));
      calls++;
      const m = user.match(/Write the section \"([^\"]+)/); if (m?.[1] === "Middle" && calls < 4) return fail("provider down");
      return ok(`done-${(user.match(/Write the section \"([^\"]+)/)?.[1] ?? "start").toLowerCase()}`);
    });
    const first = await runJob("u1", job.id, { db, call: call as any });
    expect(first.status).toBe("failed");
    const middle = [...chunks.values()].find((c) => c.section_id === "s1");
    expect(middle.status).toBe("failed");
    const startBefore = [...chunks.values()].find((c) => c.section_id === "s0");
    expect(startBefore.status).toBe("completed");
    const callsBeforeRetry = calls;
    const second = await retryJob("u1", job.id, { db, call: call as any });
    expect(second.status).toBe("completed");
    // Only the failed chunk was regenerated.
    expect(calls - callsBeforeRetry).toBe(1);
    const out = await store.latestOutput("u1", job.id, db);
    expect(out.content).toContain("done-start");
    expect(out.content).toContain("done-middle");
  });

  it("resumes an interrupted job from persisted checkpoints", async () => {
    const { db, chunks } = memDb();
    const job = await store.createJob("u1", { instructions: "Write a short guide" }, db);
    const call = vi.fn(async (msgs: any[]) => {
      const user = msgs[1].content as string;
      if (!user.includes("Your task")) return ok(JSON.stringify(["Start", "End"]));
      return ok(`text-${(user.match(/Write the section \"([^\"]+)/)?.[1] ?? "start").toLowerCase()}`);
    });
    // Simulate a crash: plan saved, one chunk done, job stuck mid-generation.
    await store.savePlan("u1", job.id, buildPlan("Write a short guide", ["Start", "End"]), db);
    await store.claimChunk("u1", job.id, 0, db);
    await store.completeChunk("u1", job.id, 0, "text-start", 10, db);
    await store.claimChunk("u1", job.id, 1, db); // stuck in "generating"
    const res = await runJob("u1", job.id, { db, call: call as any });
    expect(res.status).toBe("completed");
    expect([...chunks.values()].filter((c) => c.status === "completed")).toHaveLength(2);
    expect(call.mock.calls.filter((m: any) => String(m[0][1].content).includes("Your task"))).toHaveLength(1); // only chunk 1 regenerated
  });

  it("cancel stops further work without corrupting completed chunks", async () => {
    const { db, chunks } = memDb();
    const job = await store.createJob("u1", { instructions: "Write a short guide" }, db);
    const call = vi.fn(async (msgs: any[]) => {
      const user = msgs[1].content as string;
      if (!user.includes("Your task")) return ok(JSON.stringify(["A", "B", "Continue with C", "Finally D"]));
      await cancelJob("u1", job.id, db);
      return ok("partial");
    });
    const res = await runJob("u1", job.id, { db, call: call as any });
    expect(res.status).toBe("cancelled");
    expect((await store.getJob("u1", job.id, db))!.status).toBe("cancelled");
  });

  it("records a provider failure without losing the checkpoint", async () => {
    const { db, events } = memDb();
    const job = await store.createJob("u1", { instructions: "Write a short guide" }, db);
    const res = await runJob("u1", job.id, { db, call: (async () => fail("down")) as any });
    expect(res.status).toBe("failed");
    expect(events.some((e) => e.event_type === "job_status" && e.status === "failed")).toBe(true);
  });

  it("rejects invalid assembly when a chunk is lost", () => {
    const bad = validateAssembly([{ seq: 0, status: "completed", content: "a", checksum: checksum("a") }, { seq: 2, status: "completed", content: "c", checksum: checksum("c") }]);
    expect(bad.ok).toBe(false);
  });
  it("records unexpected provider exceptions instead of leaving a running job", async () => {
    const { db, jobs } = memDb();
    const job = await store.createJob("u1", { instructions: "Write a long guide" }, db);
    await expect(runJob("u1", job.id, { db, call: async () => { throw new Error("Provider connection closed"); } })).rejects.toThrow("Provider connection closed");
    expect(jobs.get(job.id)).toMatchObject({ status: "failed", error: "Provider connection closed" });
  });
  it("allows only one claimant for a retrying chunk", async () => {
    const { db } = memDb();
    const job = await store.createJob("u1", { instructions: "Write" }, db);
    await store.savePlan("u1", job.id, buildPlan("Write", ["One"]), db);
    await store.claimChunk("u1", job.id, 0, db);
    await store.failChunk("u1", job.id, 0, "invalid", db);
    await store.markRetryable("u1", job.id, db);
    expect(await store.claimChunk("u1", job.id, 0, db)).toMatchObject({ status: "generating" });
    expect(await store.claimChunk("u1", job.id, 0, db)).toBeNull();
  });
});
