// Tests for the 100-slot generation system: pure logic, D1 store semantics and
// the slot-based runner flow. The store is exercised against an in-memory fake
// that implements the same SQL surface the D1 binding exposes.
import { describe, expect, it } from "vitest";
import { batches, canTransition, checkRequestSize, pickFreePromptSlots, repairAllowed, slotTypeFor, SLOT_LIMITS } from "@/lib/sandbox/slots";
import { runSlotJob, validatePrompt } from "@/lib/sandbox/slot-runner.server";
import * as store from "@/lib/sandbox/slots.server";
import { fakeDb } from "./helpers/fake-slot-db";


const okCall = (text: string) => async () => ({ ok: true as const, text, finishReason: "stop", model: { provider: "nvidia" as const, model: "m", label: "m" } });
const PROMPT_TEXT = "A prompt body that is comfortably longer than forty characters.";

describe("slot pure logic", () => {
  it("assigns slot types: 1 user prompt, 2 story, 3 blueprint, 4-100 prompt", () => {
    expect(slotTypeFor(1)).toBe("user_prompt");
    expect(slotTypeFor(2)).toBe("story");
    expect(slotTypeFor(3)).toBe("blueprint");
    expect(slotTypeFor(4)).toBe("prompt");
    expect(slotTypeFor(100)).toBe("prompt");
  });
  it("caps a request at 25 prompts", () => {
    expect(checkRequestSize(25).ok).toBe(true);
    expect(checkRequestSize(26)).toEqual({ ok: false, reason: expect.stringContaining("25") });
    expect(checkRequestSize(0).ok).toBe(false);
  });
  it("splits into batches of 10", () => {
    expect(batches(25).map((b) => b.length)).toEqual([10, 10, 5]);
    expect(batches(3)).toEqual([[0, 1, 2]]);
  });
  it("allows exactly one repair attempt", () => {
    expect(repairAllowed({ status: "failed", repair_attempts: 0 })).toBe(true);
    expect(repairAllowed({ status: "failed", repair_attempts: SLOT_LIMITS.maxRepairAttempts })).toBe(false);
    expect(repairAllowed({ status: "validated", repair_attempts: 0 })).toBe(false);
  });
  it("rejects illegal status transitions", () => {
    expect(canTransition("free", "claimed")).toBe(true);
    expect(canTransition("free", "validated")).toBe(false);
    expect(canTransition("validated", "generating")).toBe(false);
    expect(canTransition("failed", "claimed")).toBe(true);
  });
  it("picks lowest free prompt slots first", () => {
    const snap = [
      { slot_id: 5, slot_type: "prompt" as const, status: "free" as const },
      { slot_id: 3, slot_type: "prompt" as const, status: "free" as const },
      { slot_id: 4, slot_type: "prompt" as const, status: "claimed" as const },
      { slot_id: 1, slot_type: "user_prompt" as const, status: "free" as const },
    ];
    expect(pickFreePromptSlots(snap, 2)).toEqual([3, 5]);
  });
});

describe("slot store (in-memory D1 semantics)", () => {
  it("seeds all 100 slots idempotently", async () => {
    const { db, slots } = fakeDb();
    await store.ensureSlots(db as any);
    await store.ensureSlots(db as any);
    expect(slots.size).toBe(100);
    expect(slots.get(1).slot_type).toBe("user_prompt");
    expect(slots.get(2).slot_type).toBe("story");
    expect(slots.get(3).slot_type).toBe("blueprint");
  });
  it("claims fixed slots once; a second job cannot take them", async () => {
    const { db } = fakeDb();
    expect(await store.claimFixedSlot("u1", "j1", 1, db as any)).toBe(true);
    expect(await store.claimFixedSlot("u2", "j2", 1, db as any)).toBe(false);
    expect(await store.claimFixedSlot("u1", "j1", 1, db as any)).toBe(true); // same job re-claim is fine
  });
  it("claims prompt slots without collision and enforces capacity", async () => {
    const { db } = fakeDb();
    const a = await store.claimPromptSlots("u1", "j1", 25, db as any);
    expect(a).toHaveLength(25);
    const b = await store.claimPromptSlots("u2", "j2", 25, db as any);
    expect(b).toHaveLength(25);
    expect(a.some((s) => b.includes(s))).toBe(false);
  });
  it("rejects illegal transitions and foreign owners", async () => {
    const { db } = fakeDb();
    await store.claimFixedSlot("u1", "j1", 1, db as any);
    expect(await store.setSlotStatus("u1", "j1", 1, "validated", {}, db as any)).toBe(false); // claimed -> validated illegal
    expect(await store.setSlotStatus("u2", "j1", 1, "generating", {}, db as any)).toBe(false); // wrong owner
    expect(await store.setSlotStatus("u1", "j1", 1, "generating", {}, db as any)).toBe(true);
  });
  it("releases job slots for reuse", async () => {
    const { db } = fakeDb();
    await store.claimPromptSlots("u1", "j1", 5, db as any);
    expect(await store.releaseJobSlots("u1", "j1", db as any)).toBe(5);
    const again = await store.claimPromptSlots("u2", "j2", 5, db as any);
    expect(again).toHaveLength(5);
  });
});

describe("slot runner flow", () => {
  it("runs blueprint → story → prompts, marking all validated", async () => {
    const { db } = fakeDb();
    const res = await runSlotJob("u1", "job-a", { instructions: "A forest tale.", count: 3 }, { db: db as any, call: okCall(PROMPT_TEXT) });
    expect(res).toEqual({ status: "completed", validated: 3, repaired: 0, failed: 0 });
  });
  it("marks repaired prompts repaired_unverified after one repair, never re-validated", async () => {
    const { db, slots } = fakeDb();
    let n = 0;
    const call = async () => {
      n++;
      // blueprint, story ok; prompt 1 too short, then repaired
      const text = n === 3 ? "short" : PROMPT_TEXT;
      return { ok: true as const, text, finishReason: "stop", model: { provider: "nvidia" as const, model: "m", label: "m" } };
    };
    const res = await runSlotJob("u1", "job-b", { instructions: "x", count: 1 }, { db: db as any, call });
    expect(res).toEqual({ status: "completed", validated: 0, repaired: 1, failed: 0 });
    const promptSlot = [...slots.values()].find((s) => s.slot_type === "prompt" && s.job_id === "job-b");
    expect(promptSlot.status).toBe("repaired_unverified");
    expect(promptSlot.repair_attempts).toBe(1);
    expect(JSON.parse(promptSlot.findings)).toContain("too_short");
  });
  it("resumes without regenerating validated slots", async () => {
    const { db } = fakeDb();
    let calls = 0;
    const call = async () => { calls++; return { ok: true as const, text: PROMPT_TEXT, finishReason: "stop", model: { provider: "nvidia" as const, model: "m", label: "m" } }; };
    await runSlotJob("u1", "job-c", { instructions: "x", count: 2 }, { db: db as any, call });
    const afterFirst = calls;
    const res = await runSlotJob("u1", "job-c", { instructions: "x", count: 2 }, { db: db as any, call });
    expect(res.validated).toBe(2);
    expect(calls).toBe(afterFirst); // no duplicate provider calls on resume
  });
  it("rejects requests above 25 prompts", async () => {
    const { db } = fakeDb();
    const res = await runSlotJob("u1", "job-d", { instructions: "x", count: 26 }, { db: db as any, call: okCall(PROMPT_TEXT) });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("25");
  });
  it("continues other prompts when one fails", async () => {
    const { db } = fakeDb();
    let n = 0;
    const call = async () => {
      n++;
      if (n === 3) return { ok: false as const, status: 503, reason: "down" }; // first prompt fails
      return { ok: true as const, text: PROMPT_TEXT, finishReason: "stop", model: { provider: "nvidia" as const, model: "m", label: "m" } };
    };
    const res = await runSlotJob("u1", "job-e", { instructions: "x", count: 2 }, { db: db as any, call });
    expect(res.status).toBe("completed");
    expect(res.validated).toBe(1);
    expect(res.failed).toBe(1);
  });
});

describe("prompt validation", () => {
  it("flags empty and too-short prompts", () => {
    expect(validatePrompt("").ok).toBe(false);
    expect(validatePrompt("tiny").findings).toContain("too_short");
    expect(validatePrompt(PROMPT_TEXT).ok).toBe(true);
  });
});
