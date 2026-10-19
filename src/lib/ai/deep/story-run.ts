import type { ModelCall, ChatMsg } from "./pipeline";
import type { RequestAnalysis } from "./analyze";
import { validateCandidate } from "./validators";
import { requestedStoryFields, storyDialogueRange, spokenStoryWords, requiresFixedStoryBackground } from "../story-output";
import {
  storyPlanSchema,
  sceneSchema,
  reviewSchema,
  parseStoryJson,
  validateStoryPlan,
  validateScene,
  initialSnapshot,
  dependentScenes,
  budgetStoryMessages,
  STORY_CATEGORIES,
  type StoryPlan,
  type StoryScene,
  type StoryIssue,
  type StoryReview,
  type StateSnapshot,
  type StoryAdapter,
} from "./story";
export type StoryRun = {
  requestId: string;
  request: string;
  plan?: StoryPlan;
  scenes: Record<string, StoryScene>;
  snapshots: Record<string, StateSnapshot>;
  reviews: Record<string, StoryReview>;
  versions: { sceneId: string; scene: StoryScene; accepted: boolean; issues: StoryIssue[] }[];
  repairs: { sceneId: string; issues: StoryIssue[] }[];
  calls: {
    model: string;
    provider: string;
    tokenization: string;
    schemaMode: string;
    inputTokens: number;
    latencyMs: number;
    error?: string;
  }[];
  audit?: StoryReview;
  scores?: Record<string, number | null>;
  issues: StoryIssue[];
  status: "running" | "passed" | "unresolved";
  result?: string;
  updatedAt: number;
  configuration: { maxRepairs: number; budgetMs: number };
};
export type StoryStore = {
  load(id: string): Promise<StoryRun | null>;
  save(run: StoryRun): Promise<void>;
};
const PLAN = `Plan a story, not its scenes. JSON only with requirements [{id,text,mandatory}], defaults [explicit nonblocking assumptions], blueprint {version:1,premise,arc,worldRules:[],visualStyle,dialogueStyle,entities:[{id,kind:"character|location|prop|event",name,profile}],canonical:[{id,entityId,field,value,requirementId}],initialState:[{entityId,field,value}],timelineRules:[],continuityConstraints:[]}, manifest [{id,order,purpose,locationId,characterIds:[],entityIds:[],requiredEvents:[],emotionalBeat,dependsOn:[],requirementIds:[],before:[{entityId,field,value}],after:[{entityId,field,value}],fields:["action","visual","environment"]}]. All string fields required. Exactly the requested scene count. Stable unique IDs; every mandatory original requirement assigned to scenes. Each scene after the first depends on the preceding scene plus causal dependencies. Preconditions must match the prior boundary. Track location, clothing, injury, possessions, knowledge, relationships, timeline and unresolved threads as relevant. Never change immutable canon. Include dialogue/camera in fields when requested. No arbitrary blueprint size cap. Blocking missing/contradictory requirements must be reported rather than guessed.`;
const SCENE = `Write one scene as JSON only: {id,blueprintVersion,entityIds:[],eventIds:[],action,visual,dialogue:[{characterId,line}],environment,camera,canonicalFacts:[{factId,value}],changes:[{entityId,field,from:null,to,evidence}],metadata:{timeline,emotionalBeat}}. All text fields are strings. Include required entities/events and exact relevant canonical values. Changes must start from validated state, never change immutable canon, and evidence must be a nonempty exact quote from action, visual or a spoken line. Give this scene a character goal, obstacle and meaningful dramatic turn; show motivation through choices and dialogue subtext rather than exposition. Use the full outline to seed future payoffs without revealing later events early. Visuals and camera must depict the actual action and validated physical state. Knowledge, possessions and recovery require an on-screen cause. Fulfil every original requirement and contract field; keep valid details unchanged during repairs. Creative additions must not contradict canon.`;
const REVIEW = `Independently review original requirements, canon, scene contracts and validated dependencies. For a plan review mandatory coverage and complete causal manifest; for a scene review story beats, visual/action agreement, dialogue/knowledge and state; for final audit examine the whole story and arc. JSON only: {checks:{story:true,visual:true,dialogue:true,continuity:true,instructions:true,structure:true},issues:[{severity:"critical|warning",category:"story|visual|dialogue|continuity|instructions|structure",sceneId,reference,evidence,correction}]}. False for any unchecked/failed category. Cite canonical fact/original requirement and exact conflicting evidence; name the smallest affected scene. Never pass unresolved critical contradictions.`;
const critical = (issues: StoryIssue[]) => issues.some((i) => i.severity === "critical");
const fail = (sceneId: string, evidence: string): StoryIssue => ({
  severity: "critical",
  category: "structure",
  sceneId,
  reference: "generation/validation",
  evidence,
  correction: "Retry this stage against the same approved contract.",
});
const reviewIssues = (r: StoryReview, id: string): StoryIssue[] => [
  ...r.issues,
  ...STORY_CATEGORIES.filter((c) => !r.checks[c] && !r.issues.some((i) => i.category === c && i.severity === "critical")).map(
    (category) => ({ ...fail(id, `${category} check failed or was not performed`), category }),
  ),
];
export function renderStory(run: StoryRun, a: RequestAnalysis): string {
  const p = run.plan;
  if (!p) return "No story plan was approved.";
  const noun = a.items?.noun ?? "scene";
  const boxed = !a.wantsJson && !a.instructions?.noHeadings && !/\b(?:plain text|no (?:markdown|boxes|fences))\b/i.test(run.request);
  const grouped = /(?:each|every|per)[^.\n]{0,100}(?:markdown\s+(?:box|block)|box|block)[^.\n]{0,140}(?:all|details|visual|dialogue|character)|(?:each|every|per)\s+(?:visual\s+)?prompt[^.\n]{0,60}(?:has|have|contains|includes)[^.\n]{0,80}(?:all|details|dialogue|character)/i.test(run.request);
  const requested = requestedStoryFields(run.request);
  const fence = (body: string) => {
    const size = Math.max(3, ...Array.from(body.matchAll(/`{3,}/g), (m) => m[0].length)) + 1;
    const marker = "`".repeat(size);
    return `${marker}markdown\n${body}\n${marker}`;
  };
  const text = p.manifest
    .filter((c) => run.scenes[c.id])
    .map((c) => {
      const s = run.scenes[c.id];
      const lines = [
        a.instructions?.noHeadings
          ? ""
          : `## ${noun.charAt(0).toUpperCase() + noun.slice(1)} ${c.order}`,
        !requested.length || requested.includes("action") ? s.action : "",
      ];
      for (const f of requested.length ? requested as typeof c.fields : c.fields)
        if (f !== "action" && (!requested.length || requested.includes(f)))
          lines.push(
            f === "dialogue"
              ? `Dialogue: ${s.dialogue.map((d) => `${p.blueprint.entities.find((e) => e.id === d.characterId)?.name ?? d.characterId}: ${d.line}`).join("\n")}`
              : `${f.charAt(0).toUpperCase() + f.slice(1)}: ${s[f]}`,
          );
      if (!boxed) return lines.filter(Boolean).join("\n\n");
      if (grouped) return fence(lines.filter(Boolean).join("\n\n"));
      return [lines[0], ...lines.slice(1).map((line, index) => line ? fence(index === 0 ? `### Story Line\n\n${line}` : line) : "")].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
  return text;
}
export async function runStructuredStory(o: {
  request: string;
  requestId: string;
  analysis: RequestAnalysis;
  system: string;
  context?: ChatMsg[];
  call: ModelCall;
  reviewCall?: ModelCall;
  adapter: StoryAdapter;
  store?: StoryStore;
  maxRepairs?: number;
  budgetMs?: number;
  now?: () => number;
  progress?: (stage: "planning" | "generating" | "verifying" | "correcting" | "assembling") => void;
}): Promise<StoryRun> {
  const now = o.now ?? Date.now,
    start = now(),
    maxRepairs = o.maxRepairs ?? 2,
    budgetMs = o.budgetMs ?? 600000;
  const saved = await o.store?.load(o.requestId);
  if (saved && saved.request !== o.request)
    throw new Error("Story request ID belongs to another request");
  if (saved?.status === "passed") return saved;
  const run: StoryRun = saved ?? {
    requestId: o.requestId,
    request: o.request,
    scenes: {},
    snapshots: {},
    reviews: {},
    versions: [],
    repairs: [],
    calls: [],
    issues: [],
    status: "running",
    updatedAt: now(),
    configuration: { maxRepairs, budgetMs },
  };
  run.status = "running";
  run.issues = [];
  run.configuration = { maxRepairs, budgetMs };
  const save = async () => {
    run.updatedAt = now();
    await o.store?.save(run);
  };
  const call = async (system: string, payload: unknown, review = false) => {
    const at = now(),
      entry = {
        model: o.adapter.model,
        provider: o.adapter.provider,
        tokenization: o.adapter.tokenization,
        schemaMode: o.adapter.schemaMode,
        inputTokens: 0,
        latencyMs: 0,
        error: undefined as string | undefined,
      };
    try {
      if (now() - start >= budgetMs)
        throw new Error("Story time budget reached; approved scenes remain saved.");
      const msgs: ChatMsg[] = [
        { role: "system", content: `${o.system}\n\n${system}\nSpoken dialogue ranges apply only to dialogue[].line, excluding speaker labels and delivery notes. Visual text and internal action do not count. All immutable clothing/background requirements must appear correctly in visible visual content, not only in canonicalFacts.` },
        { role: "user", content: JSON.stringify({ conversationContext: o.context ?? [], ...(payload as Record<string, unknown>) }) },
      ];
      const ctx = budgetStoryMessages(msgs, o.adapter);
      entry.inputTokens = ctx.tokens;
      const r = await (review ? (o.reviewCall ?? o.call) : o.call)(ctx.messages);
      if (!r.ok) throw new Error(`Provider error ${r.status}: ${r.reason}`);
      entry.model = r.model ?? entry.model;
      entry.provider = r.provider ?? entry.provider;
      if (r.finishReason === "length")
        throw new Error("Structured output exceeded output limit; not accepted.");
      return r.text;
    } catch (e) {
      entry.error = e instanceof Error ? e.message : "Story call failed";
      throw e;
    } finally {
      entry.latencyMs = now() - at;
      run.calls.push(entry);
    }
  };
  const count = o.analysis.items?.count ?? 0;
  const requested = requestedStoryFields(o.request);
  const dialogueRange = storyDialogueRange(o.request);
  const sceneRequirements = (scene: StoryScene): StoryIssue[] => {
    const words = spokenStoryWords(scene.dialogue.map((turn) => turn.line));
    return dialogueRange && (words < dialogueRange.min || words > dialogueRange.max)
      ? [{ ...fail(scene.id, `Dialogue has ${words} spoken words; required ${dialogueRange.min}–${dialogueRange.max} per scene.`), category: "dialogue", reference: "spoken-word-range" }]
      : [];
  };
  try {
    if (!run.plan) {
      o.progress?.("planning");
      let issues: StoryIssue[] = [];
      for (let attempt = 0; attempt <= maxRepairs; attempt++) {
        try {
          const p = parseStoryJson(
            await call(PLAN, { request: o.request, count, issues }),
            storyPlanSchema,
          );
          // Delivery fields are mandatory, not discretionary planner choices.
          if (requested.length) for (const contract of p.manifest) contract.fields = requested as typeof contract.fields;
          issues = validateStoryPlan(p, count);
          if (requiresFixedStoryBackground(o.request) && new Set(p.manifest.map((c) => c.locationId)).size !== 1)
            issues.push({ ...fail("plan", "The background must remain in one fixed location in all scenes."), category: "continuity" });
          if (!critical(issues)) {
            const r = parseStoryJson(
              await call(
                REVIEW,
                { request: o.request, plan: p, task: "Validate plan before scene generation" },
                true,
              ),
              reviewSchema,
            );
            issues.push(...reviewIssues(r, "plan"));
          }
          if (!critical(issues)) {
            run.plan = p;
            break;
          }
        } catch (e) {
          issues = [fail("plan", e instanceof Error ? e.message : "Invalid plan")];
        }
        run.repairs.push({ sceneId: "plan", issues });
        await save();
      }
      if (!run.plan) {
        run.issues = issues;
        throw new Error("Canonical plan remains unresolved");
      }
      await save();
    }
    const p = run.plan;
    const local = () => {
      let state = initialSnapshot(p);
      const issues: StoryIssue[] = [];
      run.snapshots = {};
      for (const c of p.manifest) {
        const s = run.scenes[c.id];
        if (!s) {
          issues.push(fail(c.id, "Scene is not approved"));
          continue;
        }
        if (c.dependsOn.some((id) => !run.snapshots[id])) {
          issues.push(fail(c.id, "A prerequisite scene has not passed validation"));
          continue;
        }
        const v = validateScene(p, c, s, state),
          r = run.reviews[c.id],
          checks = [
            ...v.issues,
            ...sceneRequirements(s),
            ...(r ? reviewIssues(r, c.id) : [fail(c.id, "Independent review unavailable")]),
          ];
        if (critical(checks)) {
          issues.push(...checks);
          continue;
        }
        state = v.candidate;
        run.snapshots[c.id] = state;
      }
      return issues;
    };
    const produce = async (c: StoryPlan["manifest"][number], extra: StoryIssue[] = []) => {
      const prev = p.manifest[c.order - 2],
        state = prev ? run.snapshots[prev.id] : initialSnapshot(p);
      if (!state || c.dependsOn.some((id) => !run.snapshots[id])) {
        run.issues.push(fail(c.id, "Validated dependency unavailable"));
        return;
      }
      let findings = extra,
        candidate = run.scenes[c.id];
      for (let attempt = 0; attempt <= maxRepairs; attempt++) {
        if (attempt || extra.length) {
          o.progress?.("correcting");
          run.repairs.push({ sceneId: c.id, issues: findings });
        } else o.progress?.("generating");
        try {
          const entities = new Set([
            ...c.entityIds,
            ...c.characterIds,
            c.locationId,
            ...c.requiredEvents,
          ]);
          const ctx = {
            request: o.request,
            requirements: p.requirements,
            storyOutline: p.manifest.map(({ id, order, purpose, emotionalBeat, requiredEvents, dependsOn }) => ({ id, order, purpose, emotionalBeat, requiredEvents, dependsOn })),
            blueprint: {
              ...p.blueprint,
              entities: p.blueprint.entities.filter((e) => entities.has(e.id)),
              canonical: p.blueprint.canonical.filter((f) => entities.has(f.entityId)),
            },
            contract: c,
            state,
            dependencies: c.dependsOn.map((id) => ({
              scene: run.scenes[id],
              state: run.snapshots[id],
            })),
            previousVersion: candidate,
            findings,
          };
          candidate = parseStoryJson(await call(SCENE, ctx), sceneSchema);
          const v = validateScene(p, c, candidate, state);
          findings = [...v.issues, ...sceneRequirements(candidate)];
          let review: StoryReview | undefined;
          if (!critical(findings)) {
            o.progress?.("verifying");
            review = parseStoryJson(
              await call(REVIEW, { ...ctx, scene: candidate }, true),
              reviewSchema,
            );
            findings.push(...reviewIssues(review, c.id));
          }
          run.versions.push({
            sceneId: c.id,
            scene: candidate,
            accepted: !critical(findings) && !!review,
            issues: findings,
          });
          if (!critical(findings) && review) {
            run.scenes[c.id] = candidate;
            run.snapshots[c.id] = v.candidate;
            run.reviews[c.id] = review;
            await save();
            return;
          }
        } catch (e) {
          findings = [fail(c.id, e instanceof Error ? e.message : "Invalid scene")];
        }
        await save();
      }
      delete run.scenes[c.id];
      delete run.snapshots[c.id];
      delete run.reviews[c.id];
      run.issues.push(...findings);
      await save();
    };
    local();
    for (const c of p.manifest) if (!run.snapshots[c.id]) await produce(c);
    for (let round = 0; round <= maxRepairs; round++) {
      const checks = local();
      if (critical(checks)) {
        run.issues.push(...checks);
        break;
      }
      o.progress?.("verifying");
      const audit = parseStoryJson(
        await call(
          REVIEW,
          {
            request: o.request,
            plan: p,
            scenes: p.manifest.map((c) => run.scenes[c.id]),
            snapshots: run.snapshots,
            task: "Final global audit of complete story",
          },
          true,
        ),
        reviewSchema,
      );
      run.audit = audit;
      const issues = reviewIssues(audit, "global");
      issues.push(
        ...validateCandidate(renderStory(run, o.analysis), dialogueRange && o.analysis.instructions ? { ...o.analysis, instructions: { ...o.analysis.instructions, words: null } } : o.analysis).flatMap((i) =>
          (i.items?.length ? i.items.map((item) => p.manifest[item - 1]?.id ?? "global") : ["global"]).map((sceneId) => ({
            ...fail(sceneId, i.message),
            category: "instructions" as const,
            reference: i.code,
          })),
        ),
      );
      if (!critical(issues)) {
        run.status = "passed";
        run.issues = issues;
        break;
      }
      run.issues = issues;
      const targets = [
        ...new Set(issues.filter((i) => i.severity === "critical").map((i) => i.sceneId)),
      ];
      if (round === maxRepairs || targets.some((id) => !p.manifest.some((c) => c.id === id))) break;
      const affected = dependentScenes(p, targets);
      for (const id of affected) delete run.snapshots[id];
      for (const c of p.manifest.filter((c) => affected.includes(c.id))) {
        if (targets.includes(c.id)) {
          await produce(
            c,
            issues.filter((i) => i.sceneId === c.id),
          );
          continue;
        }
        const prev = p.manifest[c.order - 2],
          state = prev ? run.snapshots[prev.id] : initialSnapshot(p),
          s = run.scenes[c.id];
        if (!state || !s) continue;
        const v = validateScene(p, c, s, state),
          r = parseStoryJson(
            await call(
              REVIEW,
              {
                request: o.request,
                plan: p,
                contract: c,
                scene: s,
                state,
                dependencies: c.dependsOn.map((id) => run.scenes[id]),
              },
              true,
            ),
            reviewSchema,
          ),
          findings = [...v.issues, ...sceneRequirements(s), ...reviewIssues(r, c.id)];
        if (!critical(findings)) {
          run.snapshots[c.id] = v.candidate;
          run.reviews[c.id] = r;
        } else await produce(c, findings);
      }
      await save();
    }
  } catch (e) {
    if (!run.issues.length)
      run.issues = [fail("global", e instanceof Error ? e.message : "Story failed")];
  }
  if (run.status !== "passed") run.status = "unresolved";
  run.scores = Object.fromEntries(
    STORY_CATEGORIES.map((category) => {
      const checks = Object.values(run.reviews).map((r) => r.checks[category]);
      if (run.audit)
        checks.push(
          run.audit.checks[category] &&
            !run.issues.some((i) => i.category === category && i.severity === "critical"),
        );
      return [
        category,
        checks.length
          ? Math.round(
              (100 * checks.filter(Boolean).length) / ((run.plan?.manifest.length ?? count) + 1),
            )
          : null,
      ];
    }),
  );
  o.progress?.("assembling");
  run.result = renderStory(run, o.analysis);
  await save();
  return run;
}
