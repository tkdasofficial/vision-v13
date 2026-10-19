// Cloudflare-native story/prompt generation: runs entirely on this Worker using the
// vision-sandbox D1 slot store. Layout: slot 1 = user's original prompt, slot 2 = story,
// slot 3 = blueprint, slots 4-100 = scene prompts. No GitHub Actions involvement.
// Validation is score-based: a prompt passes at >= 90; below that it is regenerated,
// then repaired with bounded "Fix Prompt" rounds (blueprint + wrong prompt + pointed
// findings) until it reaches 90. The blueprint is never delivered to the chat.
// Delivery reuses the existing runtime_jobs finalizer: the assembled document is stored
// as private artifact chunks and the job is marked "uploaded", so syncRuntimeJob/finalize
// validate it and deliver it to the chat.
import { d1 } from "@/lib/cloud/d1.server";
import { JobRun, safeError } from "@/lib/jobs/jobs.server";
import { orchestrateText, type Completion } from "../ai/orchestrator.server";
import { TEXT_CHAIN } from "../ai/models.server";
import * as slots from "../sandbox/slots.server";
import { SLOT_LIMITS } from "../sandbox/slots";
import { normalizeScene, parseSceneCount, sceneContract, scoreScene, assembleStoryDocument, validateAssembled, storyInstructions, checkStory, STORY_LIMITS } from "./cloud-story";

const now = () => new Date().toISOString();

type Call = (messages: unknown[], maxTokens: number) => Promise<Completion>;
// On the Worker: one non-streaming reply per call (fits the Free plan's CPU limit).
// Off-Worker dev: the streaming relay, since provider keys only live on Cloudflare.
const defaultCall: Call = async (messages, maxTokens) => {
  const { completeOnce, onWorker } = await import("../ai/complete-once.server");
  if (onWorker()) return completeOnce(messages, maxTokens, TEXT_CHAIN);
  return orchestrateText(messages, { maxTokens, deep: false, signal: new AbortController().signal, taskId: "cloud-story", models: TEXT_CHAIN });
};

async function sha256Hex(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Thrown when this invocation's time budget is spent; the queue resumes the job in a fresh run. */
export class StoryYield extends Error { constructor() { super("yield"); } }
/** Thrown when another story job holds the shared slots 1-3; this job waits its turn in the queue. */
export class StoryWait extends StoryYield {}

async function setStage(jobId: string, stage: string) {
  await d1("UPDATE runtime_jobs SET stage = ?, updated_at = ? WHERE job_id = ?", [stage, now(), jobId]);
}

async function cancelRequested(jobId: string): Promise<boolean> {
  const r = await d1<{ cancel_requested: number }>("SELECT cancel_requested FROM jobs WHERE id = ?", [jobId]);
  return !!r[0]?.cancel_requested;
}

/** Fails the job and releases every slot it holds so later requests are never blocked. */
async function fail(userId: string, jobId: string, message: string): Promise<void> {
  await d1("UPDATE runtime_jobs SET status = 'failed', error = ?, updated_at = ? WHERE job_id = ? AND status IN ('queued','dispatched','running')", [message.slice(0, 400), now(), jobId]);
  await slots.releaseJobSlots(userId, jobId).catch(() => {});
}

/** Generates content into a claimed slot and stores it as a generation record. */
async function generateIntoSlot(
  userId: string, jobId: string, slotId: number, kind: "user_prompt" | "blueprint" | "story" | "prompt",
  messages: unknown[], maxTokens: number, call: Call,
): Promise<{ ok: boolean; recordId?: string; content?: string; error?: string }> {
  // A slot already "generating" for this job (regeneration, or resume after a yield) stays usable.
  const claimed = await slots.setSlotStatus(userId, jobId, slotId, "generating", {})
    || (await slots.listSlots(userId, jobId)).some((s) => s.slot_id === slotId && s.status === "generating");
  if (!claimed) return { ok: false, error: "slot_unavailable" };
  const res = await call(messages, maxTokens);
  if (!res.ok || !res.text.trim()) {
    await slots.setSlotStatus(userId, jobId, slotId, "failed", { error_code: res.ok ? "empty" : `provider_${res.status}` });
    return { ok: false, error: res.ok ? "empty" : res.reason };
  }
  const content = res.text.trim();
  const recordId = await slots.saveRecord(userId, jobId, slotId, kind, content);
  return { ok: true, recordId, content };
}

/** Saved in-progress state of a generating slot: current candidate record and repair round. */
function parseProgress(raw: string | null | undefined): { ref: string; round: number } | null {
  if (!raw) return null;
  try { const p = JSON.parse(raw); return typeof p?.ref === "string" ? { ref: p.ref, round: Number(p.round) || 0 } : null; } catch { return null; }
}

/** Reads a validated slot's record, or null when it still needs generation. */
async function readValidated(userId: string, jobId: string, slotId: number): Promise<{ ref: string; content: string } | null> {
  const slot = (await slots.listSlots(userId, jobId)).find((s) => s.slot_id === slotId);
  if (slot?.status !== "validated" || !slot.result_ref) return null;
  const rec = await slots.readRecord(userId, slot.result_ref);
  return rec ? { ref: slot.result_ref, content: rec.content } : null;
}

/**
 * Runs a story_generate / prompt_generate job on Cloudflare. Resumable: slots already
 * validated for this job are never regenerated, so an interrupted run continues where
 * it stopped. Each scene prompt must score >= 90; otherwise it is regenerated once and
 * then repaired with at most SLOT_LIMITS.maxFixAttempts pointed "Fix Prompt" rounds.
 */
export async function runCloudStoryJob(job: JobRun, prompt: string, opts: { call?: Call; deadlineAt?: number; maxCalls?: number } = {}): Promise<"done" | "yield" | "wait"> {
  const maxCalls = opts.maxCalls ?? Number.POSITIVE_INFINITY;
  let calls = 0;
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const baseCall = opts.call ?? defaultCall;
  // Every provider call first proves liveness (heartbeat) and checks the invocation budget,
  // so a long job is split across queue runs instead of being killed mid-call.
  const call: Call = async (messages, maxTokens) => {
    // Free plan: each queue run makes at most maxCalls provider calls, then hands off to a fresh run.
    if (Date.now() >= deadlineAt || calls >= maxCalls) throw new StoryYield();
    calls++;
    await d1("UPDATE runtime_jobs SET updated_at = ? WHERE job_id = ?", [now(), job.id]);
    return baseCall(messages, maxTokens);
  };
  try {
    await runSteps(job, prompt, call);
    return "done";
  } catch (e) {
    if (e instanceof StoryWait) return "wait";
    if (e instanceof StoryYield) return "yield";
    throw e;
  }
}

async function runSteps(job: JobRun, prompt: string, call: Call): Promise<void> {
  const userId = job.userId;
  const jobId = job.id;
  const count = parseSceneCount(prompt);
  const contract = sceneContract(prompt);

  await slots.ensureSlots();
  await setStage(jobId, "planning");

  // Slot 1: the user's original prompt, stored verbatim (no provider call).
  if (!(await readValidated(userId, jobId, SLOT_LIMITS.userPromptSlot))) {
    if (!(await slots.claimFixedSlot(userId, jobId, 1))) throw new StoryWait();
    await slots.setSlotStatus(userId, jobId, 1, "generating", {});
    const ref = await slots.saveRecord(userId, jobId, 1, "user_prompt", prompt);
    await slots.setSlotStatus(userId, jobId, 1, "validated", { result_ref: ref });
  }

  // Slot 3: Master Blueprint (resume-aware). Generated first, never delivered.
  let blueprint = "";
  let blueprintRef: string | null = null;
  const bp = await readValidated(userId, jobId, SLOT_LIMITS.blueprintSlot);
  if (bp) {
    blueprintRef = bp.ref; blueprint = bp.content;
  } else {
    if (!(await slots.claimFixedSlot(userId, jobId, 3))) throw new StoryWait();
    const r = await generateIntoSlot(userId, jobId, 3, "blueprint", [
      { role: "system", content: "Create a master blueprint for the requested story: setting, characters (names, appearance, clothing), rules and constraints. Concise and structured; no prose story." },
      { role: "user", content: prompt },
    ], STORY_LIMITS.maxBlueprintTokens, call);
    if (!r.ok) return fail(userId, jobId, `Blueprint generation failed: ${r.error}`);
    blueprintRef = r.recordId!; blueprint = r.content!;
    await slots.setSlotStatus(userId, jobId, 3, "validated", { result_ref: blueprintRef });
  }

  // Slot 2: Story (resume-aware).
  let story = "";
  let storyRef: string | null = null;
  const st = await readValidated(userId, jobId, SLOT_LIMITS.storySlot);
  if (st) {
    storyRef = st.ref; story = st.content;
  } else {
    if (!(await slots.claimFixedSlot(userId, jobId, 2))) throw new StoryWait();
    // Prose only: scene-formatted text here would duplicate the scene prompts in the delivery.
    const ask = (fix: string[]) => generateIntoSlot(userId, jobId, 2, "story", [
      { role: "system", content: storyInstructions(count) + (fix.length ? ` The previous attempt had these problems: ${fix.join(" ")} Fix every one of them.` : "") },
      { role: "user", content: `Blueprint:\n${blueprint}\n\nRequest:\n${prompt}` },
    ], STORY_LIMITS.maxStoryTokens, call);
    // Resumable: a saved first attempt (and its findings) is reused instead of regenerated.
    const stSlot = (await slots.listSlots(userId, jobId)).find((x) => x.slot_id === 2);
    const prog = parseProgress(stSlot?.status === "generating" ? stSlot.findings : null);
    let r: { ok: boolean; recordId?: string; content?: string; error?: string };
    let round = 0;
    if (prog?.ref) {
      const rec = await slots.readRecord(userId, prog.ref);
      r = rec ? { ok: true, recordId: prog.ref, content: rec.content } : await ask([]);
      round = rec ? prog.round : 0;
    } else {
      r = await ask([]);
    }
    if (!r.ok) return fail(userId, jobId, `Story generation failed: ${r.error}`);
    await slots.saveSlotProgress(userId, jobId, 2, JSON.stringify({ ref: r.recordId, round }));
    const storyIssues = checkStory(r.content!);
    if (storyIssues.length) {
      if (round >= 1) return fail(userId, jobId, `The story did not meet its format after one regeneration: ${storyIssues.join(" ")}`);
      r = await ask(storyIssues);
      if (!r.ok) return fail(userId, jobId, `Story generation failed: ${r.error}`);
      await slots.saveSlotProgress(userId, jobId, 2, JSON.stringify({ ref: r.recordId, round: 1 }));
      const still = checkStory(r.content!);
      if (still.length) return fail(userId, jobId, `The story did not meet its format after one regeneration: ${still.join(" ")}`);
    }
    storyRef = r.recordId!; story = r.content!;
    await slots.setSlotStatus(userId, jobId, 2, "validated", { result_ref: storyRef, blueprint_ref: blueprintRef });
  }

  if (await cancelRequested(jobId)) return;

  // Slots 4+: one scene prompt per slot, in order, resumable.
  const claimedIds = await slots.claimPromptSlots(userId, jobId, count);
  if (claimedIds.length < count) {
    return fail(userId, jobId, `Only ${claimedIds.length} of ${count} scene slots are free right now.`);
  }
  const scenes: string[] = [];
  let failedScenes = 0;
  for (let i = 0; i < count; i++) {
    if (await cancelRequested(jobId)) return;
    const slotId = claimedIds[i];
    await setStage(jobId, `writing_scene_${i + 1}`);
    const current = (await slots.listSlots(userId, jobId)).find((s) => s.slot_id === slotId);
    if (!current) { failedScenes++; continue; }
    if (current.status === "validated" && current.result_ref) {
      scenes.push((await slots.readRecord(userId, current.result_ref))?.content ?? "");
      continue;
    }

    // Generate, then score. Below 90: regenerate once, then bounded Fix Prompt rounds.
    // Every candidate is checkpointed on the slot, so each step can run in its own queue run.
    const sceneMsgs = (extra: string) => [
      { role: "system", content: contract + extra },
      { role: "user", content: `Blueprint:\n${blueprint}\n\nStory:\n${story}\n\nRequest:\n${prompt}\n\nWrite scene ${i + 1} of ${count}.` },
    ];
    const prog = parseProgress(current.status === "generating" ? current.findings : null);
    let content = "";
    let round = 0; // 0 = first draft, 1 = regenerated, 1 + n = after n Fix Prompt rounds
    if (prog?.ref) {
      const rec = await slots.readRecord(userId, prog.ref);
      if (rec) { content = normalizeScene(rec.content, i); round = prog.round; }
    }
    if (!content) {
      const gen = await generateIntoSlot(userId, jobId, slotId, "prompt", sceneMsgs(""), STORY_LIMITS.maxSceneTokens, call);
      if (!gen.ok) { failedScenes++; continue; }
      content = normalizeScene(gen.content!, i);
      await slots.saveSlotProgress(userId, jobId, slotId, JSON.stringify({ ref: gen.recordId, round: 0 }));
    }
    let { score, issues } = scoreScene(content, i, prompt);
    if (score < SLOT_LIMITS.passScore && round === 0) {
      // One full regeneration with the pointed findings.
      const gen = await generateIntoSlot(userId, jobId, slotId, "prompt", sceneMsgs(` The previous attempt failed these checks: ${issues.join(" ")} Fix every one of them.`), STORY_LIMITS.maxSceneTokens, call);
      if (!gen.ok) { failedScenes++; continue; }
      round = 1;
      const candidate = normalizeScene(gen.content!, i);
      const rescored = scoreScene(candidate, i, prompt);
      // Keep whichever version scores higher; a worse rewrite never replaces a better draft.
      if (rescored.score >= score) { content = candidate; ({ score, issues } = rescored); }
      const ref = await slots.saveRecord(userId, jobId, slotId, "prompt", content);
      await slots.saveSlotProgress(userId, jobId, slotId, JSON.stringify({ ref, round }));
    }

    while (score < SLOT_LIMITS.passScore && round - 1 < SLOT_LIMITS.maxFixAttempts) {
      const fix = await call([
        { role: "system", content: "Fix Prompt: repair the scene so it satisfies every pointed finding. Return only the corrected scene, keeping the required headings and staying consistent with the blueprint." },
        { role: "user", content: `Blueprint:\n${blueprint}\n\nPointed fixes required: ${issues.join(" ")}\n\nWrong prompt:\n${content}` },
      ], STORY_LIMITS.maxSceneTokens);
      if (!fix.ok || !fix.text.trim()) break;
      round++;
      const candidate = normalizeScene(fix.text, i);
      const rescored = scoreScene(candidate, i, prompt);
      if (rescored.score >= score) { content = candidate; ({ score, issues } = rescored); }
      const ref = await slots.saveRecord(userId, jobId, slotId, "prompt", content);
      await slots.saveSlotProgress(userId, jobId, slotId, JSON.stringify({ ref, round }));
    }

    if (score >= SLOT_LIMITS.passScore) {
      const recId = await slots.saveRecord(userId, jobId, slotId, "prompt", content);
      await slots.setSlotStatus(userId, jobId, slotId, "validated", { result_ref: recId, blueprint_ref: blueprintRef, story_ref: storyRef });
      scenes.push(content);
    } else {
      // Honest failure: keep the findings as private diagnostics, never claim a pass.
      await slots.setSlotStatus(userId, jobId, slotId, "failed", { findings: JSON.stringify({ score, issues }), error_code: "below_pass_score" });
      failedScenes++;
    }
  }

  if (failedScenes === count) return fail(userId, jobId, "Every scene failed generation or repair.");

  // Assemble in order and run the whole-document contract check before delivery.
  await setStage(jobId, "assembling");
  const doc = assembleStoryDocument({ story, scenes });
  const issues = validateAssembled(doc, prompt);
  if (issues.length) {
    return fail(userId, jobId, `The assembled story did not meet the request: ${issues.slice(0, 5).join(" ")}`.slice(0, 400));
  }

  // Hand off to the existing finalizer: store privately, mark uploaded.
  const bytes = new TextEncoder().encode(doc);
  const { putD1Artifact } = await import("@/lib/jobs/artifact-store.server");
  const stored = await putD1Artifact(bytes);
  const hash = await sha256Hex(bytes);
  await d1(
    "UPDATE runtime_jobs SET status = 'uploaded', output_key = ?, output_chunks = ?, output_size = ?, output_sha256 = ?, output_name = ?, result = ?, updated_at = ? WHERE job_id = ? AND status = 'running'",
    [stored.key, stored.chunks, bytes.length, hash, "story.md", JSON.stringify({ scenes: count, failedScenes, engine: "cloudflare-slots" }), now(), jobId],
  );
}
