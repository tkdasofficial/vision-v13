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
    expect(q("SELECT * FROM cleanup_tasks")).toHaveLength(0);
    await closeStoryWorkspace("u1", "rt-job-1", true, db);
    expect(q("SELECT workflow_status FROM generation_jobs")[0].workflow_status).toBe("succeeded");
    expect(q("SELECT * FROM cleanup_tasks")).toHaveLength(1);
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
