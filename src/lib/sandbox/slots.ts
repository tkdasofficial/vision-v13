// Pure slot-allocation logic for the 100-slot generation system. No I/O.
// Layout: slot 1 = user's original prompt, slot 2 = story, slot 3 = blueprint,
// slots 4-100 = generated prompts (1..97 per request, capped at 25).
export const SLOT_LIMITS = {
  totalSlots: 100,
  userPromptSlot: 1,
  storySlot: 2,
  blueprintSlot: 3,
  firstPromptSlot: 4,
  maxPromptsPerRequest: 25,
  batchSize: 10,
  maxRepairAttempts: 1,
  /** A prompt passes validation at or above this score (0-100). */
  passScore: 90,
  /** Bounded "Fix Prompt" rounds per prompt after the first regeneration. */
  maxFixAttempts: 3,
} as const;

export type SlotType = "user_prompt" | "story" | "blueprint" | "prompt";
export type SlotStatus = "free" | "claimed" | "generating" | "validated" | "repaired_unverified" | "failed" | "cancelled";
export type Slot = {
  slot_id: number; slot_type: SlotType; user_id: string | null; job_id: string | null;
  prompt_index: number | null; status: SlotStatus; result: string | null; result_ref: string | null;
  blueprint_ref: string | null; story_ref: string | null; findings: string | null;
  repair_attempts: number; error_code: string | null; created_at: number | null; updated_at: number | null;
};

export function slotTypeFor(slotId: number): SlotType {
  if (slotId === SLOT_LIMITS.userPromptSlot) return "user_prompt";
  if (slotId === SLOT_LIMITS.storySlot) return "story";
  if (slotId === SLOT_LIMITS.blueprintSlot) return "blueprint";
  return "prompt";
}

/** Capacity check: prompt slots are 4..100 (97 slots); a request is capped at 25. */
export function checkRequestSize(count: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: "Prompt count must be a positive integer." };
  if (count > SLOT_LIMITS.maxPromptsPerRequest) return { ok: false, reason: `A request may ask for at most ${SLOT_LIMITS.maxPromptsPerRequest} prompts.` };
  return { ok: true };
}

/** Splits prompt indexes into batches of `batchSize` (default 10), preserving order. */
export function batches(count: number, batchSize: number = SLOT_LIMITS.batchSize): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < count; start += batchSize) {
    out.push(Array.from({ length: Math.min(batchSize, count - start) }, (_, i) => start + i));
  }
  return out;
}

/** Allowed status transitions; anything else is rejected by the store. */
const TRANSITIONS: Record<SlotStatus, SlotStatus[]> = {
  free: ["claimed"],
  claimed: ["generating", "free", "cancelled"],
  generating: ["validated", "repaired_unverified", "failed", "cancelled", "claimed"],
  validated: ["free"],
  repaired_unverified: ["free"],
  failed: ["claimed", "free"],
  cancelled: ["free"],
};

export function canTransition(from: SlotStatus, to: SlotStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether a failed prompt may be repaired: exactly one repair attempt is allowed. */
export function repairAllowed(slot: Pick<Slot, "status" | "repair_attempts">): boolean {
  return slot.status === "failed" && slot.repair_attempts < SLOT_LIMITS.maxRepairAttempts;
}

/** After a repair the result is marked repaired_unverified — never claimed as passed. */
export function postRepairStatus(): SlotStatus {
  return "repaired_unverified";
}

/** Picks the next free prompt slots for a job, lowest slot id first. Pure selection from a snapshot. */
export function pickFreePromptSlots(slots: Pick<Slot, "slot_id" | "slot_type" | "status">[], needed: number): number[] {
  return slots
    .filter((s) => s.slot_type === "prompt" && s.status === "free")
    .map((s) => s.slot_id)
    .sort((a, b) => a - b)
    .slice(0, needed);
}
