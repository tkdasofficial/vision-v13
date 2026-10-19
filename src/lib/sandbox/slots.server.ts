// Owner-scoped D1 access for the 100-slot generation store (vision-sandbox).
// Every query filters by user_id once a slot is claimed; claims use atomic
// conditional UPDATEs so two runners can never own the same slot.
import { sandboxDb, type SandboxDb } from "./db.server";
import { canTransition, pickFreePromptSlots, slotTypeFor, SLOT_LIMITS, type Slot, type SlotStatus } from "./slots";

const now = () => Date.now();
const id = () => crypto.randomUUID();

// Initialization costs ~100 queries, and Cloudflare caps database calls per Worker run, so it
// runs once per database handle per isolate (a failed attempt is retried on the next call).
let ensured = new WeakMap<SandboxDb, Promise<void>>();

/** Forgets completed setup (tests swap the database behind the same handle). */
export function resetSlotSetup(): void { ensured = new WeakMap(); }

/** Idempotent initialization: every statement is safe to re-run; done once per isolate. */
export async function ensureSlots(db: SandboxDb = sandboxDb): Promise<void> {
  let pending = ensured.get(db);
  if (!pending) {
    pending = initSlots(db);
    ensured.set(db, pending);
    pending.catch(() => ensured.delete(db));
  }
  await pending;
}

async function initSlots(db: SandboxDb): Promise<void> {
  await db(`CREATE TABLE IF NOT EXISTS generation_slots (
    slot_id INTEGER PRIMARY KEY CHECK (slot_id BETWEEN 1 AND 100),
    slot_type TEXT NOT NULL CHECK (slot_type IN ('user_prompt','story','blueprint','prompt')),
    user_id TEXT, job_id TEXT, prompt_index INTEGER,
    status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','claimed','generating','validated','repaired_unverified','failed','cancelled')),
    result TEXT, result_ref TEXT, blueprint_ref TEXT, story_ref TEXT, findings TEXT,
    repair_attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, created_at INTEGER, updated_at INTEGER)`);
  await db(`CREATE TABLE IF NOT EXISTS generation_records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, job_id TEXT NOT NULL,
    slot_id INTEGER NOT NULL REFERENCES generation_slots(slot_id),
    kind TEXT NOT NULL CHECK (kind IN ('user_prompt','story','blueprint','prompt')),
    content TEXT NOT NULL, checksum TEXT, created_at INTEGER NOT NULL)`);
  for (let s = 1; s <= SLOT_LIMITS.totalSlots; s++) {
    await db("INSERT OR IGNORE INTO generation_slots (slot_id, slot_type) VALUES (?, ?)", [s, slotTypeFor(s)]);
  }
}

export async function listSlots(userId: string, jobId: string, db: SandboxDb = sandboxDb): Promise<Slot[]> {
  await ensureSlots(db);
  return db("SELECT * FROM generation_slots WHERE user_id = ? AND job_id = ? ORDER BY slot_id", [userId, jobId]);
}

/** Atomically claims a fixed slot (1 user prompt, 2 story, 3 blueprint); false when another job holds it. */
export async function claimFixedSlot(userId: string, jobId: string, slotId: 1 | 2 | 3, db: SandboxDb = sandboxDb): Promise<boolean> {
  await ensureSlots(db);
  const rows = await db(
    "UPDATE generation_slots SET user_id = ?, job_id = ?, status = 'claimed', updated_at = ? WHERE slot_id = ? AND (status = 'free' OR (user_id = ? AND job_id = ?)) RETURNING slot_id",
    [userId, jobId, now(), slotId, userId, jobId],
  );
  return rows.length > 0;
}

/** Atomically claims up to `needed` free prompt slots, one UPDATE per slot to stay race-safe. */
export async function claimPromptSlots(userId: string, jobId: string, needed: number, db: SandboxDb = sandboxDb): Promise<number[]> {
  await ensureSlots(db);
  const all: Slot[] = await db("SELECT slot_id, slot_type, status FROM generation_slots ORDER BY slot_id");
  const mine: Slot[] = await db("SELECT slot_id, slot_type, status FROM generation_slots WHERE user_id = ? AND job_id = ? AND slot_type = 'prompt'", [userId, jobId]);
  const already = mine.length;
  const want = Math.max(0, needed - already);
  const candidates = pickFreePromptSlots(all, want);
  const claimed: number[] = mine.map((s) => s.slot_id).sort((a, b) => a - b);
  for (const slotId of candidates) {
    const rows = await db(
      "UPDATE generation_slots SET user_id = ?, job_id = ?, prompt_index = ?, status = 'claimed', repair_attempts = 0, findings = NULL, error_code = NULL, updated_at = ? WHERE slot_id = ? AND status = 'free' RETURNING slot_id",
      [userId, jobId, claimed.length + 1, now(), slotId],
    );
    if (rows.length) claimed.push(slotId);
  }
  return claimed;
}

/** Compare-and-swap status change; refuses illegal transitions and foreign owners. */
export async function setSlotStatus(userId: string, jobId: string, slotId: number, to: SlotStatus, patch: Partial<Pick<Slot, "result" | "result_ref" | "findings" | "error_code" | "blueprint_ref" | "story_ref">> = {}, db: SandboxDb = sandboxDb): Promise<boolean> {
  await ensureSlots(db);
  const cur: Slot | undefined = (await db("SELECT * FROM generation_slots WHERE slot_id = ? AND user_id = ? AND job_id = ? LIMIT 1", [slotId, userId, jobId]))[0];
  if (!cur || !canTransition(cur.status, to)) return false;
  const sets = ["status = ?", "updated_at = ?"];
  const params: unknown[] = [to, now()];
  for (const key of ["result", "result_ref", "findings", "error_code", "blueprint_ref", "story_ref"] as const) {
    if (patch[key] !== undefined) { sets.push(`${key} = ?`); params.push(patch[key]); }
  }
  if (to === "repaired_unverified") sets.push("repair_attempts = repair_attempts + 1");
  const rows = await db(`UPDATE generation_slots SET ${sets.join(", ")} WHERE slot_id = ? AND user_id = ? AND job_id = ? AND status = ? RETURNING slot_id`, [...params, slotId, userId, jobId, cur.status]);
  return rows.length > 0;
}

/** Checkpoints in-progress work (current candidate + repair round) on a slot this job is generating. */
export async function saveSlotProgress(userId: string, jobId: string, slotId: number, findings: string, db: SandboxDb = sandboxDb): Promise<boolean> {
  const rows = await db("UPDATE generation_slots SET findings = ?, updated_at = ? WHERE slot_id = ? AND user_id = ? AND job_id = ? AND status = 'generating' RETURNING slot_id", [findings, now(), slotId, userId, jobId]);
  return rows.length > 0;
}

/** Stores a large body in generation_records and points the slot at it. */
export async function saveRecord(userId: string, jobId: string, slotId: number, kind: "user_prompt" | "blueprint" | "story" | "prompt", content: string, db: SandboxDb = sandboxDb): Promise<string> {
  await ensureSlots(db);
  const recId = id();
  const buf = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const checksum = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db("INSERT INTO generation_records (id, user_id, job_id, slot_id, kind, content, checksum, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [recId, userId, jobId, slotId, kind, content, checksum, now()]);
  return recId;
}

export async function readRecord(userId: string, recordId: string, db: SandboxDb = sandboxDb): Promise<{ content: string; checksum: string | null } | null> {
  await ensureSlots(db);
  return (await db("SELECT content, checksum FROM generation_records WHERE id = ? AND user_id = ? LIMIT 1", [recordId, userId]))[0] ?? null;
}

/** Releases every slot a job holds back to free; used for cleanup and reuse. */
export async function releaseJobSlots(userId: string, jobId: string, db: SandboxDb = sandboxDb): Promise<number> {
  await ensureSlots(db);
  const rows = await db(
    "UPDATE generation_slots SET status = 'free', user_id = NULL, job_id = NULL, prompt_index = NULL, result = NULL, result_ref = NULL, blueprint_ref = NULL, story_ref = NULL, findings = NULL, repair_attempts = 0, error_code = NULL, updated_at = ? WHERE user_id = ? AND job_id = ? RETURNING slot_id",
    [now(), userId, jobId],
  );
  return rows.length;
}
