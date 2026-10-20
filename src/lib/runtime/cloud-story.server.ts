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
import { runtimeStageStep } from "./progress";
import { orchestrateText, type Completion } from "../ai/orchestrator.server";
import { TEXT_CHAIN } from "../ai/models.server";
import * as slots from "../sandbox/slots.server";
import { SLOT_LIMITS } from "../sandbox/slots";
import { openStoryWorkspace } from "../sandbox/story-workspace.server";
import { storyDialogueRange, requiresFixedStoryBackground } from "../ai/story-output";
import { normalizeScene, parseSceneCount, sceneContract, sceneHeadings, scoreScene, assembleStoryDocument, validateAssembled, storyInstructions, checkStory, STORY_LIMITS } from "./cloud-story";
import { blueprintInstructions, qualityReviewInstructions, parseQualityReview, replaceStoryParagraph, readQualityCheckpoint, validateQualityBlueprint, duplicateStoryFindings, QUALITY_LIMITS } from "./story-quality";

const now = () => new Date().toISOString();

type Call = (messages: unknown[], maxTokens: number, beforeDispatch?: () => Promise<void>) => Promise<Completion>;
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

async function setStage(job: JobRun, stage: string) {
  const mapped = runtimeStageStep(stage);
  const last = job.steps.at(-1);
  if (mapped && (last?.status !== mapped[0] || last.detail !== mapped[1])) await job.step(...mapped);
  await d1("UPDATE runtime_jobs SET stage = ?, updated_at = ? WHERE job_id = ?", [stage, now(), job.id]);
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
  const call: Call = async (messages, maxTokens, beforeDispatch) => {
    // Free plan: each queue run makes at most maxCalls provider calls, then hands off to a fresh run.
    if (Date.now() >= deadlineAt || calls >= maxCalls) throw new StoryYield();
    // Reserve the edit before provider work, but never charge a pre-call queue yield.
    await beforeDispatch?.();
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
  await job.step("inspecting", "Reading saved story progress");
  // Per-job workspace record (vision-sandbox, migration 0005): mirrors what actually happens below.
  const jobRow = (await d1<{ created_at: string }>("SELECT created_at FROM jobs WHERE id = ? AND user_id = ?", [jobId, userId]))[0];
  const w = await openStoryWorkspace({
    userId, jobId, chatId: job.sessionId, prompt, count,
    meta: { headings: sceneHeadings(prompt), dialogue: storyDialogueRange(prompt), fixedBackground: requiresFixedStoryBackground(prompt) },
    queuedAt: jobRow?.created_at ? Date.parse(jobRow.created_at) : undefined,
  });
  await w.heartbeat();

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
    await setStage(job, "planning");
    const r = await generateIntoSlot(userId, jobId, 3, "blueprint", [
      { role: "system", content: blueprintInstructions(count) },
      { role: "user", content: prompt },
    ], STORY_LIMITS.maxBlueprintTokens, call);
    if (!r.ok) return fail(userId, jobId, `Blueprint generation failed: ${r.error}`);
    if (!r.recordId || !r.content) return fail(userId, jobId, "Blueprint record is missing.");
    try { validateQualityBlueprint(r.content, count); }
    catch { return fail(userId, jobId, "The blueprint lacks complete character profiles or ordered continuity beats; saved draft retained, not approved."); }
    blueprintRef = r.recordId; blueprint = r.content;
    await slots.setSlotStatus(userId, jobId, 3, "validated", { result_ref: blueprintRef });
    await w.blueprint(blueprint);
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
    const ask = async (fix: string[]) => {
      await setStage(job, fix.length ? "retrying_story" : "writing_story");
      return generateIntoSlot(userId, jobId, 2, "story", [
      { role: "system", content: storyInstructions(count) + (fix.length ? ` The previous attempt had these problems: ${fix.join(" ")} Fix every one of them.` : "") },
      { role: "user", content: `Blueprint:\n${blueprint}\n\nRequest:\n${prompt}` },
      ], STORY_LIMITS.maxStoryTokens, call);
    };
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
    await setStage(job, "validating_story");
    // Paragraph duplicates are local quality findings, not a reason to regenerate
    // the full narrative. The final quality loop repairs the affected paragraph.
    const storyIssues = checkStory(r.content ?? "").filter((issue) => !issue.includes("duplicate narrative paragraphs"));
    if (storyIssues.length) {
      if (round >= 1) return fail(userId, jobId, `The story did not meet its format after one regeneration: ${storyIssues.join(" ")}`);
      r = await ask(storyIssues);
      if (!r.ok) return fail(userId, jobId, `Story generation failed: ${r.error}`);
      await slots.saveSlotProgress(userId, jobId, 2, JSON.stringify({ ref: r.recordId, round: 1 }));
      await setStage(job, "validating_story");
      const still = checkStory(r.content ?? "").filter((issue) => !issue.includes("duplicate narrative paragraphs"));
      if (still.length) return fail(userId, jobId, `The story did not meet its format after one regeneration: ${still.join(" ")}`);
    }
    if (!r.recordId || !r.content) return fail(userId, jobId, "Story record is missing.");
    storyRef = r.recordId; story = r.content;
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
    const current = (await slots.listSlots(userId, jobId)).find((s) => s.slot_id === slotId);
    if (!current) { failedScenes++; continue; }
    if (current.status === "validated" && current.result_ref) {
      scenes.push((await slots.readRecord(userId, current.result_ref))?.content ?? "");
      continue;
    }

    await setStage(job, `writing_scene_${i + 1}`);

    // Generate, then score. Below 90: regenerate once, then bounded Fix Prompt rounds.
    // Every candidate is checkpointed on the slot, so each step can run in its own queue run.
    const sceneMsgs = (extra: string) => [
      { role: "system", content: contract + extra },
      { role: "user", content: `Blueprint and ordered beat assignments:\n${blueprint}\n\nStory:\n${story}\n\nPrevious accepted scene (actual state boundary):\n${scenes.at(-1) ?? "Initial blueprint state"}\n\nRequest:\n${prompt}\n\nWrite scene ${i + 1} of ${count}. Cover only its assigned beat; do not repeat another scene or anticipate later events.` },
    ];
    const prog = parseProgress(current.status === "generating" ? current.findings : null);
    let content = "";
    let round = 0; // 0 = first draft, 1 = regenerated, 1 + n = after n Fix Prompt rounds
    if (prog?.ref) {
      const rec = await slots.readRecord(userId, prog.ref);
      if (rec) { content = normalizeScene(rec.content, i); round = prog.round; }
    }
    let fresh = false;
    if (!content) {
      const t0 = Date.now();
      const gen = await generateIntoSlot(userId, jobId, slotId, "prompt", sceneMsgs(""), STORY_LIMITS.maxSceneTokens, call);
      await w.attempt(4 + i, "generation", t0, gen.ok, gen.ok ? undefined : String(gen.error ?? "failed"));
      if (!gen.ok) { failedScenes++; await w.slotDone(i, false); continue; }
      content = normalizeScene(gen.content ?? "", i);
      await slots.saveSlotProgress(userId, jobId, slotId, JSON.stringify({ ref: gen.recordId, round: 0 }));
      fresh = true;
    }
    await setStage(job, `validating_scene_${i + 1}`);
    let { score, issues } = scoreScene(content, i, prompt);
    if (fresh) await w.validated(i, content, issues, "generation");
    if (score < SLOT_LIMITS.passScore && round === 0) {
      // One full regeneration with the pointed findings.
      await setStage(job, `retrying_scene_${i + 1}`);
      const t0 = Date.now();
      const gen = await generateIntoSlot(userId, jobId, slotId, "prompt", sceneMsgs(` The previous attempt failed these checks: ${issues.join(" ")} Fix every one of them.`), STORY_LIMITS.maxSceneTokens, call);
      await w.attempt(4 + i, "retry", t0, gen.ok, gen.ok ? undefined : String(gen.error ?? "failed"));
      if (!gen.ok) { failedScenes++; await w.slotDone(i, false); continue; }
      round = 1;
      const candidate = normalizeScene(gen.content ?? "", i);
      await setStage(job, `validating_scene_${i + 1}`);
      const rescored = scoreScene(candidate, i, prompt);
      await w.validated(i, candidate, rescored.issues, "retry");
      // Keep whichever version scores higher; a worse rewrite never replaces a better draft.
      if (rescored.score >= score) { content = candidate; ({ score, issues } = rescored); }
      const ref = await slots.saveRecord(userId, jobId, slotId, "prompt", content);
      await slots.saveSlotProgress(userId, jobId, slotId, JSON.stringify({ ref, round }));
    }

    while (score < SLOT_LIMITS.passScore && round - 1 < SLOT_LIMITS.maxFixAttempts) {
      await setStage(job, `correcting_scene_${i + 1}`);
      const t0 = Date.now();
      const fix = await call([
        { role: "system", content: "Fix Prompt: repair only the affected scene, preserving valid details. " + contract },
        { role: "user", content: `Request:\n${prompt}\n\nBlueprint:\n${blueprint}\n\nStory:\n${story}\n\nPrevious accepted scene:\n${scenes.at(-1) ?? "Initial state"}\n\nWrite scene ${i + 1} of ${count}. Pointed fixes required: ${issues.join(" ")}\n\nWrong prompt:\n${content}` },
      ], STORY_LIMITS.maxSceneTokens);
      await w.attempt(4 + i, "repair", t0, fix.ok && !!fix.text.trim(), fix.ok ? (fix.text.trim() ? undefined : "empty") : `provider_${fix.status}`);
      if (!fix.ok || !fix.text.trim()) break;
      round++;
      const candidate = normalizeScene(fix.text, i);
      await setStage(job, `validating_scene_${i + 1}`);
      const rescored = scoreScene(candidate, i, prompt);
      await w.validated(i, candidate, rescored.issues, "repair");
      if (rescored.score >= score) { content = candidate; ({ score, issues } = rescored); }
      const ref = await slots.saveRecord(userId, jobId, slotId, "prompt", content);
      await slots.saveSlotProgress(userId, jobId, slotId, JSON.stringify({ ref, round }));
    }

    if (score >= SLOT_LIMITS.passScore) {
      const recId = await slots.saveRecord(userId, jobId, slotId, "prompt", content);
      await slots.setSlotStatus(userId, jobId, slotId, "validated", { result_ref: recId, blueprint_ref: blueprintRef, story_ref: storyRef });
      scenes.push(content);
      await w.slotDone(i, true);
    } else {
      await w.slotDone(i, false);
      // Honest failure: keep the findings as private diagnostics, never claim a pass.
      await slots.setSlotStatus(userId, jobId, slotId, "failed", { findings: JSON.stringify({ score, issues }), error_code: "below_pass_score" });
      failedScenes++;
    }
  }

  if (failedScenes || scenes.length !== count) return fail(userId, jobId, `${failedScenes} scene(s) failed generation or repair; saved drafts retained, incomplete output was not delivered.`);

  // Reuse Deep's semantic review contract, not another generation pipeline. Slot 1's
  // optional result JSON holds candidate-bound reviews/overrides across queue yields.
  const originalSlot = (await slots.listSlots(userId, jobId)).find((s) => s.slot_id === 1);
  const quality = readQualityCheckpoint(originalSlot?.result);
  for (const [target, ref] of Object.entries(quality.refs)) {
    const saved = await slots.readRecord(userId, ref);
    if (!saved) return fail(userId, jobId, "A saved story repair is unavailable; drafts retained.");
    if (target === "story") story = saved.content;
    else {
      const match = /^scene:(\d+)$/.exec(target);
      if (!match || Number(match[1]) > scenes.length) return fail(userId, jobId, "Invalid saved repair target.");
      scenes[Number(match[1]) - 1] = saved.content;
    }
  }
  const checkpoint = () => slots.saveStoryQuality(userId, jobId, JSON.stringify(quality));
  while (true) {
    if (await cancelRequested(jobId)) return;
    const hash = await sha256Hex(new TextEncoder().encode(JSON.stringify({ prompt, blueprint, story, scenes })));
    if (quality.hash !== hash || !quality.findings) {
      await setStage(job, "reviewing_story");
      const duplicates = duplicateStoryFindings(story, scenes, prompt);
      if (duplicates.length) {
        quality.findings = duplicates;
        quality.hash = hash;
        quality.passed = false;
        await checkpoint();
      } else {
      const response = await call([
        { role: "system", content: qualityReviewInstructions },
        { role: "user", content: JSON.stringify({ request: prompt, blueprint, storyParagraphs: story.split(/\n\s*\n/).map((text, i) => ({ reference: `paragraph:${i + 1}`, text })), scenes: scenes.map((text, i) => ({ sceneId: `scene:${i + 1}`, text })), task: "Audit all scenes, narrative agreement and dependent boundaries; identify only grounded failures." }) },
      ], STORY_LIMITS.maxSceneTokens);
      if (!response.ok || !response.text.trim()) return fail(userId, jobId, "Story semantic review unavailable; saved drafts retained and not falsely approved.");
      try { quality.findings = parseQualityReview(response.text, story, scenes); }
      catch (error) { return fail(userId, jobId, safeError(error)); }
      quality.hash = hash;
      quality.passed = !quality.findings.some((f) => f.severity === "critical");
      await checkpoint();
      }
    }
    const finding = quality.findings?.find((f) => f.severity === "critical");
    if (!finding) { quality.passed = true; break; }
    const target = finding.sceneId === "story" ? finding.reference : finding.sceneId;
    const attempts = quality.repairs[target] ?? 0;
    if (attempts >= QUALITY_LIMITS.perSection || Object.values(quality.repairs).reduce((a, b) => a + b, 0) >= QUALITY_LIMITS.maxRepairs) {
      await w.finalValidation(quality.findings?.filter((f) => f.severity === "critical").map((f) => `${f.sceneId} ${f.category}: ${f.correction}`) ?? []);
      return fail(userId, jobId, `Unresolved ${finding.sceneId} ${finding.category}: ${finding.correction}. Drafts retained; repair limit reached.`);
    }
    const match = /^scene:(\d+)$/.exec(finding.sceneId);
    const index = match ? Number(match[1]) - 1 : -1;
    await setStage(job, index >= 0 ? `correcting_scene_${index + 1}` : "repairing_story");
    const response = await call([
      { role: "system", content: index >= 0 ? `Fix Prompt: repair only scene ${index + 1}. Preserve approved details and correct only the grounded findings. ${contract}` : "Repair only the identified story paragraph. Return one prose paragraph without headings. Preserve all facts and approved neighboring content." },
      { role: "user", content: JSON.stringify({ request: prompt, blueprint, story, scenes, target: finding, findings: quality.findings?.filter((f) => f.sceneId === finding.sceneId && (index >= 0 || f.reference === finding.reference)), instruction: "Do not rewrite unaffected sections. Neighboring scenes are approved context; preserve their boundaries." }) },
    ], STORY_LIMITS.maxSceneTokens, async () => {
      quality.repairs[target] = attempts + 1;
      await checkpoint();
    });
    if (!response.ok || !response.text.trim()) return fail(userId, jobId, "Targeted story repair failed; original drafts retained.");
    let revised = "";
    let structural: string[] = [];
    try {
      revised = index >= 0 ? normalizeScene(response.text, index) : replaceStoryParagraph(story, finding.reference, response.text);
      structural = index >= 0 ? scoreScene(revised, index, prompt).issues : checkStory(revised).filter((issue) => !issue.includes("duplicate narrative paragraphs"));
    } catch (error) { structural = [safeError(error)]; }
    if (!structural.length) {
      const key = index >= 0 ? finding.sceneId : "story";
      const ref = await slots.saveRecord(userId, jobId, index >= 0 ? claimedIds[index] : 2, index >= 0 ? "prompt" : "story", revised);
      quality.refs[key] = ref;
      if (index >= 0) scenes[index] = revised; else story = revised;
      quality.hash = undefined; quality.findings = undefined; quality.passed = false;
    }
    // A structurally bad rewrite never replaces a recoverable original. The attempt
    // is still durable; next run repairs again within the same bound.
    await checkpoint();
  }

  // Assemble in order and run the whole-document contract check before delivery.
  await setStage(job, "assembling");
  const doc = assembleStoryDocument({ story, scenes, prompt });
  await setStage(job, "validating_output");
  const issues = validateAssembled(doc, prompt);
  await w.finalValidation(issues);
  if (issues.length) {
    return fail(userId, jobId, `The assembled story did not meet the request: ${issues.slice(0, 5).join(" ")}`.slice(0, 400));
  }

  // Hand off to the existing finalizer: store privately, mark uploaded.
  const bytes = new TextEncoder().encode(doc);
  await job.step("saving", "Storing the verified story for delivery");
  const { putD1Artifact } = await import("@/lib/jobs/artifact-store.server");
  const stored = await putD1Artifact(bytes);
  const hash = await sha256Hex(bytes);
  await d1(
    "UPDATE runtime_jobs SET status = 'uploaded', output_key = ?, output_chunks = ?, output_size = ?, output_sha256 = ?, output_name = ?, result = ?, updated_at = ? WHERE job_id = ? AND status = 'running'",
    [stored.key, stored.chunks, bytes.length, hash, "story.md", JSON.stringify({ scenes: count, failedScenes, engine: "cloudflare-slots", quality: { version: 1, hash: quality.hash, passed: quality.passed, checks: "all scenes and narrative", repairs: quality.repairs, findings: quality.findings } }), now(), jobId],
  );
}
