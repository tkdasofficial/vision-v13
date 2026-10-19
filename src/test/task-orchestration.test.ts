import { describe, it, expect } from "vitest";
import { STAGE_LABELS, applyTaskEvent, parseTaskEvent, taskEmitter, needsLiveFacts, type TaskEvent } from "@/lib/ai/task-events";
import { splitUnits, revealPlan } from "@/lib/ai/render-scheduler";

const ev = (seq: number, stage: any, taskId = "task-1"): TaskEvent => ({ taskId, seq, stage, ts: 0 });

describe("task events", () => {
  it("orders, de-duplicates, allows repeats and ignores stale tasks", () => {
    let s = applyTaskEvent(null, ev(1, "thinking"), "task-1");
    s = applyTaskEvent(s, ev(2, "validating"), "task-1");
    s = applyTaskEvent(s, ev(2, "reasoning"), "task-1"); // duplicate seq
    s = applyTaskEvent(s, ev(3, "correcting"), "task-1");
    s = applyTaskEvent(s, ev(4, "validating"), "task-1"); // repeat stage
    s = applyTaskEvent(s, ev(9, "researching", "old"), "task-1"); // stale task
    expect(s!.stage).toBe("validating");
    expect(s!.history).toEqual(["thinking", "validating", "correcting", "validating"]);
    s = applyTaskEvent(s, ev(5, "failed"), "task-1");
    expect(applyTaskEvent(s, ev(6, "finalizing"), "task-1")!.stage).toBe("failed");
  });
  it("rejects malformed events and numbers emitted ones", () => {
    expect(parseTaskEvent({ taskId: "x", seq: 1, stage: "hacking" })).toBeNull();
    const lines: string[] = []; const emit = taskEmitter("t1", (l) => lines.push(l));
    emit("thinking"); emit("finalizing");
    const parsed = lines.map((l) => parseTaskEvent(JSON.parse(l.slice(6)).vision_task)!);
    expect(parsed.map((p) => [p.seq, p.stage])).toEqual([[1, "thinking"], [2, "finalizing"]]);
  });
  it("only auto-researches requests that need current facts", () => {
    expect(needsLiveFacts("What is the latest iPhone price?")).toBe(true);
    expect(needsLiveFacts("Write a poem about rain")).toBe(false);
  });
  it("never emits progress after a terminal failure", () => {
    const lines: string[] = []; const emit = taskEmitter("t", (line) => lines.push(line));
    emit("thinking"); emit("switching_provider"); emit("failed"); emit("reasoning");
    expect(lines.map((line) => JSON.parse(line.slice(6)).vision_task.stage)).toEqual(["thinking", "switching_provider", "failed"]);
  });
});

describe("render scheduler", () => {
  const md = "# Title\n\nPara one. Two.\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n```ts\nconst a = 1;\n```";
  it("splits into units that rebuild the original exactly", () => {
    const u = splitUnits(md);
    expect(u.join("\n")).toBe(md);
    expect(u).toContain("| A | B |\n|---|---|\n| 1 | 2 |");
  });
  it("ends at full length, is batched and bounded", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `Sentence number ${i} is here.`).join("\n\n");
    const p = revealPlan(big);
    expect(p[p.length - 1].upto).toBe(big.length);
    expect(p.length).toBeLessThan(200);
    expect(p.reduce((a, s) => a + s.delayMs, 0)).toBeLessThanOrEqual(9100);
    expect(revealPlan(md).at(-1)!.upto).toBe(md.length);
  });
});

describe("status catalogue", () => {
  it("keeps answer completion separate from task failures", () => {
    const labels = Object.values(STAGE_LABELS);
    for (const bad of ["Completed", "Splash", "Accuracy", "Rendering Response"]) expect(labels).not.toContain(bad);
    expect(parseTaskEvent({ taskId: "t", seq: 1, stage: "completed" })).toBeNull();
  });
});
