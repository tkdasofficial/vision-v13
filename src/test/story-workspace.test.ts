// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "@/lib/sandbox/workspace";
import { openStoryWorkspace, closeStoryWorkspace, splitScores } from "@/lib/sandbox/story-workspace.server";

let raw: DatabaseSync;
let db: Db;
beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync("db/migrations/0001_vision_sandbox.sql", "utf8"));
  raw.exec(readFileSync("db/migrations/0005_prompt_workspace.sql", "utf8"));
  db = async (sql, params = []) => raw.prepare(sql).all(...(params as any[])) as any[];
});
const meta = { headings: ["Visual Prompt", "Dialogue"], dialogue: { min: 25, max: 30 }, fixedBackground: false };
const open = (jobId = "rt-job-1") => openStoryWorkspace({ userId: "u1", jobId, chatId: "chat-1", prompt: "5 scenes story", count: 5, meta, db });

describe("story workspace bridge", () => {
  it("prompt passes only when both scores reach 90", () => {
    expect(splitScores([])).toMatchObject({ consistency: 100, continuity: 100 });
    expect(splitScores(["Scene 2 dialogue has 12 words"]).consistency).toBe(75);
  });

  it("records 5 prompt slots, versions, attempts and cleanup only after delivery", async () => {
    const w = await open();
    await w.blueprint("blueprint");
    for (let i = 0; i < 5; i++) {
      await w.attempt(4 + i, "generation", Date.now(), true);
      expect(await w.validated(i, `scene ${i}`, i === 0 ? ["Scene 1 dialogue has 10 words"] : [], "generation")).toBe(i === 0 ? "failed" : "passed");
      if (i === 0) { await w.attempt(4, "repair", Date.now(), true); expect(await w.validated(0, "fixed", [], "repair")).toBe("passed"); }
      await w.slotDone(i, true);
    }
    await w.finalValidation([]);
    const q = (s: string) => raw.prepare(s).all() as any[];
    expect(q("SELECT * FROM job_slots WHERE slot_type='generated_prompt' AND status='completed'")).toHaveLength(5);
    expect(q("SELECT * FROM prompt_versions WHERE slot_id=(SELECT slot_id FROM job_slots WHERE slot_index=4)")).toHaveLength(2);
    expect(q("SELECT * FROM validation_findings")).toHaveLength(1);
    expect(q("SELECT requested_prompt_count FROM request_context")[0].requested_prompt_count).toBe(5);
    expect(q("SELECT * FROM cleanup_tasks")).toHaveLength(0);
    await closeStoryWorkspace("u1", "rt-job-1", true, db);
    expect(q("SELECT workflow_status FROM generation_jobs")[0].workflow_status).toBe("succeeded");
    expect(q("SELECT * FROM cleanup_tasks")).toHaveLength(1);
  });

  const TEMP = ["generation_requests", "request_context", "request_constraints", "job_slots", "prompt_versions", "generation_attempts", "validation_runs", "validation_findings", "job_timing_metrics"];
  const count = (t: string, jobId?: string) => {
    const col = t === "prompt_versions" ? "slot_id IN (SELECT slot_id FROM job_slots WHERE job_id = ?)" : t === "validation_findings" ? "validation_id IN (SELECT validation_id FROM validation_runs WHERE job_id = ?)" : "job_id = ?";
    return jobId ? (raw.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${col}`).get(jobId) as any).c : (raw.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
  };
  const build = async (userId: string, rtId: string) => {
    const w = await openStoryWorkspace({ userId, jobId: rtId, chatId: `chat-${rtId}`, prompt: "p", count: 5, meta, db });
    await w.blueprint("bp");
    for (let i = 0; i < 5; i++) { await w.attempt(4 + i, "generation", Date.now(), true); await w.validated(i, `s${i}`, i === 0 ? ["Scene 1 dialogue has 10 words"] : [], "generation"); await w.slotDone(i, true); }
    await w.finalValidation([]);
    return (raw.prepare("SELECT id FROM generation_jobs WHERE idempotency_key = ?").get(`runtime:${rtId}`) as any).id as string;
  };

  it("cleans the sandbox immediately once the reply is verified saved", async () => {
    const id = await build("u1", "rt-a");
    await closeStoryWorkspace("u1", "rt-a", true, db, async () => true);
    for (const t of TEMP) expect(count(t, id)).toBe(0);
    expect((raw.prepare("SELECT cleanup_status FROM cleanup_tasks WHERE job_id = ?").get(id) as any).cleanup_status).toBe("completed");
    const ev = raw.prepare("SELECT event_type FROM generation_events WHERE job_id = ?").all(id) as any[];
    expect(ev.map((e) => e.event_type)).toEqual(["cleanup_completed"]);
  });

  it("keeps sandbox data when the reply is not verified or delivery failed", async () => {
    const a = await build("u1", "rt-b");
    await closeStoryWorkspace("u1", "rt-b", true, db, async () => false);
    expect(count("job_slots", a)).toBeGreaterThan(0);
    expect((raw.prepare("SELECT cleanup_status, scheduled_at FROM cleanup_tasks WHERE job_id = ?").get(a) as any).scheduled_at).toBeGreaterThan(Date.now() + 60_000);
    const b = await build("u1", "rt-c");
    await closeStoryWorkspace("u1", "rt-c", false, db, async () => true);
    expect(count("job_slots", b)).toBeGreaterThan(0);
    expect((raw.prepare("SELECT workflow_status FROM generation_jobs WHERE id = ?").get(b) as any).workflow_status).toBe("failed");
    // verifier throwing = not verified
    const c = await build("u1", "rt-d");
    await closeStoryWorkspace("u1", "rt-d", true, db, async () => { throw new Error("d1 down"); });
    expect(count("prompt_versions", c)).toBeGreaterThan(0);
  });

  it("retries and concurrent closes are idempotent", async () => {
    const id = await build("u1", "rt-e");
    await closeStoryWorkspace("u1", "rt-e", true, db, async () => false); // first try not yet verified
    expect(count("job_slots", id)).toBeGreaterThan(0);
    await Promise.all([1, 2, 3].map(() => closeStoryWorkspace("u1", "rt-e", true, db, async () => true)));
    for (const t of TEMP) expect(count(t, id)).toBe(0);
    expect(raw.prepare("SELECT * FROM cleanup_tasks WHERE job_id = ?").all(id)).toHaveLength(1);
    expect(raw.prepare("SELECT * FROM generation_events WHERE job_id = ? AND event_type = 'delivered'").all(id)).toHaveLength(0);
    await closeStoryWorkspace("u1", "rt-e", true, db, async () => true);
    expect(raw.prepare("SELECT * FROM generation_events WHERE job_id = ? AND event_type = 'cleanup_completed'").all(id)).toHaveLength(1);
  });

  it("never touches other jobs or other users", async () => {
    const mine = await build("u1", "rt-f");
    const other = await build("u1", "rt-g");
    const theirs = await build("u2", "rt-h");
    const before = TEMP.map((t) => [count(t, other), count(t, theirs)]);
    await closeStoryWorkspace("u1", "rt-f", true, db, async () => true);
    // another user cannot trigger cleanup of u2's job
    await closeStoryWorkspace("u1", "rt-h", true, db, async () => true);
    for (const t of TEMP) expect(count(t, mine)).toBe(0);
    expect(TEMP.map((t) => [count(t, other), count(t, theirs)])).toEqual(before);
  });

  it("resuming the same runtime job never creates a second workspace", async () => {
    await open(); await open();
    expect(raw.prepare("SELECT * FROM generation_jobs").all()).toHaveLength(1);
  });

  it("is a no-op without a chat", async () => {
    const w = await openStoryWorkspace({ userId: "u1", jobId: "x-job-123", chatId: null, prompt: "p", count: 5, meta, db });
    expect(w.active()).toBe(false);
  });
});
