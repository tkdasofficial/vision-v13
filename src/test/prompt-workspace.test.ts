// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as w from "@/lib/sandbox/workspace";

let raw: DatabaseSync;
let db: w.Db;
const owns = async () => true;
const base = { chatId: "chat-a", originalRequest: "Write 5 image prompts about a lighthouse", ownsChat: owns };

beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync("db/migrations/0001_vision_sandbox.sql", "utf8"));
  raw.exec(readFileSync("db/migrations/0005_prompt_workspace.sql", "utf8"));
  raw.exec("CREATE TABLE chat_messages (id TEXT, body TEXT); INSERT INTO chat_messages VALUES ('m1','delivered')");
  db = async (sql, params = []) => raw.prepare(sql).all(...(params as any[])) as any[];
});

const promptSlots = (s: any[]) => s.filter((x) => x.slot_type === "generated_prompt");

describe("prompt workspace", () => {
  it.each([5, 15, 25])("allocates 28 slots for %i prompts, extra marked unused", async (n) => {
    const { slots } = await w.initJob(db, "u1", { ...base, requestedPromptCount: n, idempotencyKey: `k${n}` });
    expect(slots).toHaveLength(28);
    expect(slots.slice(0, 3).map((s) => s.slot_type)).toEqual(["original_request", "request_metadata", "blueprint"]);
    expect(promptSlots(slots).filter((s) => s.status === "pending")).toHaveLength(n);
  });

  it("allocates beyond 25 when requested and can expand later", async () => {
    const { job, slots } = await w.initJob(db, "u1", { ...base, requestedPromptCount: 40, idempotencyKey: "k40" });
    expect(slots).toHaveLength(43);
    expect(await w.expandPrompts(db, "u1", job.id, 60)).toHaveLength(63);
  });

  it("is idempotent and keeps concurrent jobs separate", async () => {
    const a = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "same" });
    const again = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "same" });
    const b = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "other" });
    expect(again.job.id).toBe(a.job.id);
    expect(again.slots).toHaveLength(28);
    expect(b.job.id).not.toBe(a.job.id);
    expect(new Set([...a.slots, ...b.slots].map((s) => s.slot_id)).size).toBe(56);
  });

  it("rejects unowned chats and cross-user access", async () => {
    await expect(w.initJob(db, "u1", { ...base, ownsChat: async () => false, requestedPromptCount: 5, idempotencyKey: "x" })).rejects.toThrow();
    const { job, slots } = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "x" });
    await expect(w.saveVersion(db, "u2", slots[3].slot_id, "hijack")).rejects.toThrow();
    await expect(w.transition(db, "u2", job.id, "initializing")).rejects.toThrow();
    expect(await w.listSlots(db, "u2", job.id)).toHaveLength(0);
  });

  it("requires both scores >= 90 and never invents a score", () => {
    expect(w.judge(95, 89)).toBe("failed");
    expect(w.judge(90, 90)).toBe("passed");
    expect(w.judge(99, null)).toBe("not_measurable");
  });

  it("records validation, repair versions, attempts and timing", async () => {
    const { job, slots } = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "v" });
    const slot = slots[3].slot_id;
    const a1 = await w.startAttempt(db, "u1", slot, "generation");
    const v1 = await w.saveVersion(db, "u1", slot, "prompt v1");
    await w.endAttempt(db, "u1", a1.attemptId, "succeeded");
    const r1 = await w.recordValidation(db, "u1", v1.versionId, { consistency: 95, continuity: 80, findings: [{ issueType: "continuity", severity: "high", description: "lamp colour changed", requiredFix: "keep red lamp" }] });
    expect(r1.status).toBe("failed");
    const rep = await w.startAttempt(db, "u1", slot, "repair");
    const v2 = await w.saveVersion(db, "u1", slot, "prompt v2 complete");
    expect(v2.versionNumber).toBe(2);
    expect(rep.attemptNumber).toBe(1);
    const current = raw.prepare("SELECT version_number FROM prompt_versions WHERE slot_id = ? AND is_current = 1").all(slot);
    expect(current).toEqual([{ version_number: 2 }]);
    await w.recordTiming(db, "u1", job.id, { slotId: slot, queueWaitMs: 100, generationMs: 300, repairMs: 50 });
    expect(raw.prepare("SELECT total_work_ms FROM job_timing_metrics").get()).toEqual({ total_work_ms: 350 });
  });

  it("enforces transitions; cancel and stall-expiry schedule cleanup", async () => {
    const { job } = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "t" });
    expect(await w.transition(db, "u1", job.id, "delivering")).toBe(false);
    expect(await w.transition(db, "u1", job.id, "initializing")).toBe(true);
    expect(await w.transition(db, "u1", job.id, "cancelled")).toBe(true);
    expect(await w.transition(db, "u1", job.id, "generating")).toBe(false);
    const b = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "s", deadlineMs: 1 });
    await w.transition(db, "u1", b.job.id, "initializing");
    expect(await w.expireStalled(db, Date.now() + 60_000)).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM cleanup_tasks").get()).toEqual({ n: 2 });
  });

  it("cleanup deletes only the target job's workspace, never chat history", async () => {
    const a = await w.initJob(db, "u1", { ...base, requestedPromptCount: 5, idempotencyKey: "c1" });
    const b = await w.initJob(db, "u2", { ...base, requestedPromptCount: 5, idempotencyKey: "c2" });
    await w.saveVersion(db, "u1", a.slots[3].slot_id, "p");
    await w.scheduleCleanup(db, "u1", a.job.id, 0);
    await w.scheduleCleanup(db, "u1", a.job.id, 0);
    expect(await w.runCleanup(db, Date.now() + 1)).toBe(1);
    expect(await w.listSlots(db, "u1", a.job.id)).toHaveLength(0);
    expect(await w.listSlots(db, "u2", b.job.id)).toHaveLength(28);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM chat_messages").get()).toEqual({ n: 1 });
    expect(await w.runCleanup(db, Date.now() + 1)).toBe(0);
  });
});
