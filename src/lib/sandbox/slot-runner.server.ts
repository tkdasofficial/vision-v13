// Slot-based prompt generation flow on the vision-sandbox D1 store:
// original prompt (slot 1) → story (slot 2) → blueprint (slot 3) → prompts (slots 4-100) in batches of 10,
// one validation pass, at most one repair per prompt (marked repaired_unverified,
// never claimed as passed). Resumable: claimed/validated slots are never regenerated.
import { orchestrateText, type Completion } from "../ai/orchestrator.server";
import { TEXT_CHAIN } from "../ai/models.server";
import { batches, checkRequestSize, SLOT_LIMITS, type Slot } from "./slots";
import * as slots from "./slots.server";
import type { SandboxDb } from "./db.server";

type Call = (messages: unknown[], maxTokens: number, signal: AbortSignal) => Promise<Completion>;
const defaultCall: Call = (messages, maxTokens, signal) =>
  orchestrateText(messages, { maxTokens, deep: false, signal, taskId: "slots", models: TEXT_CHAIN });

export type SlotRunResult = {
  status: "completed" | "failed" | "cancelled";
  validated: number; repaired: number; failed: number;
  error?: string;
};

/** Mandatory structural constraints checked without a provider call. */
export function validatePrompt(content: string): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  const text = content.trim();
  if (!text) findings.push("empty_prompt");
  if (text.length < 40) findings.push("too_short");
  if (text.length > 20_000) findings.push("too_long");
  return { ok: findings.length === 0, findings };
}

async function generateIntoSlot(
  userId: string, jobId: string, slotId: number, kind: "blueprint" | "story" | "prompt",
  messages: unknown[], maxTokens: number, call: Call, signal: AbortSignal, db: SandboxDb,
): Promise<{ ok: boolean; recordId?: string; content?: string; error?: string }> {
  const claimed = await slots.setSlotStatus(userId, jobId, slotId, "generating", {}, db);
  if (!claimed) return { ok: false, error: "slot_unavailable" };
  const res = await call(messages, maxTokens, signal);
  if (!res.ok || !res.text.trim()) {
    await slots.setSlotStatus(userId, jobId, slotId, "failed", { error_code: res.ok ? "empty" : `provider_${res.status}` }, db);
    return { ok: false, error: res.ok ? "empty" : res.reason };
  }
  const content = res.text.trim();
  const recordId = await slots.saveRecord(userId, jobId, slotId, kind, content, db);
  return { ok: true, recordId, content };
}

/**
 * Runs a story prompt-generation job: blueprint, story, then `count` prompts in
 * batches of 10. Each prompt gets one generation plus at most one repair.
 */
export async function runSlotJob(userId: string, jobId: string, input: {
  instructions: string; count: number; story?: boolean;
}, opts: { db?: SandboxDb; call?: Call; signal?: AbortSignal } = {}): Promise<SlotRunResult> {
  const db = opts.db ?? (await import("./db.server")).sandboxDb;
  const call = opts.call ?? defaultCall;
  const signal = opts.signal ?? new AbortController().signal;
  const size = checkRequestSize(input.count);
  if (!size.ok) return { status: "failed", validated: 0, repaired: 0, failed: 0, error: size.reason };

  await slots.ensureSlots(db);
  const isStory = input.story !== false;
  let blueprintRef: string | null = null;
  let storyRef: string | null = null;
  let blueprint = "";
  let story = "";

  if (isStory) {
    // Slot 1: original instructions. Slot 2: Story. Slot 3: Master Blueprint.
    // Resume skips slots already done.
    const existing = await slots.listSlots(userId, jobId, db);
    const up = existing.find((s) => s.slot_id === SLOT_LIMITS.userPromptSlot);
    if (up?.status !== "validated") {
      if (!(await slots.claimFixedSlot(userId, jobId, 1, db))) return { status: "failed", validated: 0, repaired: 0, failed: 0, error: "request slot unavailable" };
      await slots.setSlotStatus(userId, jobId, 1, "generating", {}, db);
      const ref = await slots.saveRecord(userId, jobId, 1, "user_prompt", input.instructions, db);
      await slots.setSlotStatus(userId, jobId, 1, "validated", { result_ref: ref }, db);
    }
    const bp = existing.find((s) => s.slot_id === SLOT_LIMITS.blueprintSlot);
    const st = existing.find((s) => s.slot_id === SLOT_LIMITS.storySlot);
    if (bp?.status === "validated" && bp.result_ref) {
      blueprintRef = bp.result_ref;
      blueprint = (await slots.readRecord(userId, bp.result_ref, db))?.content ?? "";
    } else {
      if (!(await slots.claimFixedSlot(userId, jobId, 3, db))) return { status: "failed", validated: 0, repaired: 0, failed: 0, error: "blueprint slot unavailable" };
      const r = await generateIntoSlot(userId, jobId, 3, "blueprint", [
        { role: "system", content: "Create a master blueprint for the requested work: setting, characters, rules and constraints. Concise, structured, no prose story." },
        { role: "user", content: input.instructions },
      ], 1200, call, signal, db);
      if (!r.ok) return { status: "failed", validated: 0, repaired: 0, failed: 0, error: `blueprint: ${r.error}` };
      blueprintRef = r.recordId!; blueprint = r.content!;
      await slots.setSlotStatus(userId, jobId, 3, "validated", { result_ref: blueprintRef }, db);
    }
    if (st?.status === "validated" && st.result_ref) {
      storyRef = st.result_ref;
      story = (await slots.readRecord(userId, st.result_ref, db))?.content ?? "";
    } else {
      if (!(await slots.claimFixedSlot(userId, jobId, 2, db))) return { status: "failed", validated: 0, repaired: 0, failed: 0, error: "story slot unavailable" };
      const r = await generateIntoSlot(userId, jobId, 2, "story", [
        { role: "system", content: "Write the story exactly following the blueprint. Keep characters, setting and rules consistent." },
        { role: "user", content: `Blueprint:\n${blueprint}\n\nRequest:\n${input.instructions}` },
      ], 4096, call, signal, db);
      if (!r.ok) return { status: "failed", validated: 0, repaired: 0, failed: 0, error: `story: ${r.error}` };
      storyRef = r.recordId!; story = r.content!;
      await slots.setSlotStatus(userId, jobId, 2, "validated", { result_ref: storyRef, blueprint_ref: blueprintRef }, db);
    }
  }

  // Prompt slots 3-100: claim exactly `count`, then process in batches of 10.
  const claimedIds = await slots.claimPromptSlots(userId, jobId, input.count, db);
  if (claimedIds.length < input.count) {
    return { status: "failed", validated: 0, repaired: 0, failed: 0, error: `only ${claimedIds.length} prompt slots free` };
  }
  let validated = 0, repaired = 0, failed = 0;
  for (const batch of batches(input.count)) {
    if (signal.aborted) return { status: "cancelled", validated, repaired, failed };
    for (const promptIndex of batch) {
      const slotId = claimedIds[promptIndex];
      const current: Slot | undefined = (await slots.listSlots(userId, jobId, db)).find((s) => s.slot_id === slotId);
      if (!current) { failed++; continue; }
      if (current.status === "validated") { validated++; continue; } // resume: never regenerate
      if (current.status === "repaired_unverified") { repaired++; continue; }

      const context = isStory
        ? `Blueprint:\n${blueprint}\n\nStory:\n${story}\n\n`
        : "";
      const gen = await generateIntoSlot(userId, jobId, slotId, "prompt", [
        { role: "system", content: "Write one prompt exactly as requested. Stay consistent with the provided blueprint and story." },
        { role: "user", content: `${context}Request:\n${input.instructions}\n\nWrite prompt ${promptIndex + 1} of ${input.count}.` },
      ], 1500, call, signal, db);
      if (!gen.ok) { failed++; continue; }

      const check = validatePrompt(gen.content!);
      if (check.ok) {
        await slots.setSlotStatus(userId, jobId, slotId, "validated", { result_ref: gen.recordId, blueprint_ref: blueprintRef, story_ref: storyRef }, db);
        validated++;
        continue;
      }
      // One repair attempt with the exact findings and the original prompt as context.
      if (current.repair_attempts >= SLOT_LIMITS.maxRepairAttempts) { failed++; continue; }
      const fix = await call([
        { role: "system", content: "Repair the prompt so it satisfies every finding. Return only the corrected prompt." },
        { role: "user", content: `Findings: ${check.findings.join(", ")}\n\nOriginal prompt:\n${gen.content}` },
      ], 1500, signal);
      if (fix.ok && fix.text.trim()) {
        const recId = await slots.saveRecord(userId, jobId, slotId, "prompt", fix.text.trim(), db);
        // No second validation in this configuration: mark repaired_unverified, keep findings.
        await slots.setSlotStatus(userId, jobId, slotId, "repaired_unverified", { result_ref: recId, findings: JSON.stringify(check.findings), blueprint_ref: blueprintRef, story_ref: storyRef }, db);
        repaired++;
      } else {
        await slots.setSlotStatus(userId, jobId, slotId, "failed", { findings: JSON.stringify(check.findings), error_code: "repair_failed" }, db);
        failed++;
      }
    }
  }
  return { status: failed === input.count ? "failed" : "completed", validated, repaired, failed };
}
