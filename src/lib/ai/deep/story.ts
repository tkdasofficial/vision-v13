import { z } from "zod";
import type { ChatMsg } from "./pipeline";

const id = z.string().min(1);
const text = z.string().min(1);
const fact = z.object({ id, entityId: id, field: text, value: text, requirementId: id });
const stateFact = z.object({ entityId: id, field: text, value: text });
export const STORY_CATEGORIES = [
  "story",
  "visual",
  "dialogue",
  "continuity",
  "instructions",
  "structure",
] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];
export const storyPlanSchema = z.object({
  requirements: z.array(z.object({ id, text, mandatory: z.boolean() })).min(1),
  defaults: z.array(z.string()),
  blueprint: z.object({
    version: z.number().int().positive(),
    premise: text,
    arc: text,
    worldRules: z.array(text),
    visualStyle: text,
    dialogueStyle: text,
    entities: z.array(
      z.object({
        id,
        kind: z.enum(["character", "location", "prop", "event"]),
        name: text,
        profile: text,
      }),
    ),
    canonical: z.array(fact),
    initialState: z.array(stateFact),
    timelineRules: z.array(text),
    continuityConstraints: z.array(text),
  }),
  manifest: z
    .array(
      z.object({
        id,
        order: z.number().int().positive(),
        purpose: text,
        locationId: id,
        characterIds: z.array(id),
        entityIds: z.array(id),
        requiredEvents: z.array(id),
        emotionalBeat: text,
        dependsOn: z.array(id),
        requirementIds: z.array(id),
        before: z.array(stateFact),
        after: z.array(stateFact),
        fields: z.array(z.enum(["action", "visual", "dialogue", "environment", "camera"])).min(1),
      }),
    )
    .min(1),
});
export type StoryPlan = z.infer<typeof storyPlanSchema>;
export type SceneContract = StoryPlan["manifest"][number];
export const sceneSchema = z.object({
  id,
  blueprintVersion: z.number().int().positive(),
  entityIds: z.array(id),
  eventIds: z.array(id),
  action: text,
  visual: text,
  dialogue: z.array(z.object({ characterId: id, line: text })),
  environment: text,
  camera: z.string(),
  canonicalFacts: z.array(z.object({ factId: id, value: text })),
  changes: z.array(
    z.object({ entityId: id, field: text, from: z.string().nullable(), to: text, evidence: text }),
  ),
  metadata: z.object({ timeline: text, emotionalBeat: text }),
});
export type StoryScene = z.infer<typeof sceneSchema>;
export type StoryIssue = {
  severity: "critical" | "warning";
  category: StoryCategory;
  sceneId: string;
  reference: string;
  evidence: string;
  correction: string;
};
export type StateSnapshot = {
  sceneId: string;
  values: Record<string, string>;
  sources: Record<string, { sceneId: string; evidence: string }>;
};
export const stateKey = (entityId: string, field: string) => JSON.stringify([entityId, field]);
const issue = (
  sceneId: string,
  category: StoryCategory,
  reference: string,
  evidence: string,
  correction: string,
): StoryIssue => ({ severity: "critical", sceneId, category, reference, evidence, correction });

/** Manifest validation refuses missing scenes, unknown references, cycles and contradictory canon. */
export function validateStoryPlan(p: StoryPlan, count: number): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const add = (reference: string, evidence: string) =>
    issues.push(
      issue(
        "plan",
        "structure",
        reference,
        evidence,
        "Repair the complete plan before generating scenes.",
      ),
    );
  const unique = (values: string[], reference: string) => {
    if (new Set(values).size !== values.length) add(reference, "Duplicate IDs");
  };
  unique(
    p.blueprint.entities.map((e) => e.id),
    "entity IDs",
  );
  unique(
    p.requirements.map((r) => r.id),
    "requirement IDs",
  );
  unique(
    p.blueprint.canonical.map((f) => f.id),
    "canonical IDs",
  );
  unique(
    p.manifest.map((s) => s.id),
    "scene IDs",
  );
  const entities = new Map(p.blueprint.entities.map((e) => [e.id, e]));
  const reqs = new Set(p.requirements.map((r) => r.id));
  if (p.manifest.length !== count)
    add("scene count", `Expected ${count}, received ${p.manifest.length}`);
  const prior = new Set<string>();
  p.manifest.forEach((s, i) => {
    if (s.order !== i + 1) add(s.id, "Scene order is missing, duplicated or reversed");
    if (entities.get(s.locationId)?.kind !== "location") add(s.id, "Unknown location ID");
    for (const eid of [
      ...s.entityIds,
      ...s.characterIds,
      ...s.requiredEvents,
      ...s.before.map((f) => f.entityId),
      ...s.after.map((f) => f.entityId),
    ])
      if (!entities.has(eid)) add(s.id, `Unknown entity ${eid}`);
    for (const cid of s.characterIds)
      if (entities.get(cid)?.kind !== "character") add(s.id, `Invalid character ${cid}`);
    for (const eid of s.requiredEvents)
      if (entities.get(eid)?.kind !== "event") add(s.id, `Invalid event ${eid}`);
    for (const d of s.dependsOn)
      if (!prior.has(d))
        add(s.id, `Dependency ${d} is unknown or not earlier (cycle/forward reference)`);
    if (i && !s.dependsOn.includes(p.manifest[i - 1].id))
      add(s.id, "A continuous story must depend on its previous scene boundary");
    for (const rid of s.requirementIds) if (!reqs.has(rid)) add(s.id, `Unknown requirement ${rid}`);
    prior.add(s.id);
  });
  for (const r of p.requirements.filter((r) => r.mandatory))
    if (!p.manifest.some((s) => s.requirementIds.includes(r.id)))
      add(r.id, "Mandatory requirement is not assigned to any scene");
  const canon = new Map<string, string>();
  for (const f of p.blueprint.canonical) {
    if (!entities.has(f.entityId) || !reqs.has(f.requirementId))
      add(f.id, "Unknown canonical entity or requirement");
    const key = stateKey(f.entityId, f.field);
    if (canon.has(key) && canon.get(key) !== f.value) add(f.id, "Contradictory canonical facts");
    canon.set(key, f.value);
  }
  const values = Object.fromEntries(
    p.blueprint.initialState.map((f) => [stateKey(f.entityId, f.field), f.value]),
  );
  const initialKeys = p.blueprint.initialState.map((f) => stateKey(f.entityId, f.field));
  unique(initialKeys, "initial state");
  for (const f of p.blueprint.initialState) {
    if (!entities.has(f.entityId)) add("initial state", `Unknown entity ${f.entityId}`);
    const key = stateKey(f.entityId, f.field);
    if (canon.has(key) && canon.get(key) !== f.value) add("initial state", "Initial state contradicts immutable canon");
  }
  for (const s of p.manifest) {
    for (const f of s.before)
      if (values[stateKey(f.entityId, f.field)] !== f.value)
        add(s.id, `Precondition ${f.entityId}.${f.field} does not follow the preceding boundary`);
    for (const f of s.after) {
      const key = stateKey(f.entityId, f.field);
      if (canon.has(key) && canon.get(key) !== f.value)
        add(s.id, "Manifest changes immutable canon");
      values[key] = f.value;
    }
  }
  return issues;
}

export function initialSnapshot(p: StoryPlan): StateSnapshot {
  return {
    sceneId: "initial",
    values: Object.fromEntries(
      p.blueprint.initialState.map((f) => [stateKey(f.entityId, f.field), f.value]),
    ),
    sources: {},
  };
}

/** Pure candidate transition: caller commits this snapshot only after semantic checks also pass. */
export function validateScene(
  p: StoryPlan,
  c: SceneContract,
  scene: StoryScene,
  previous: StateSnapshot,
): { issues: StoryIssue[]; candidate: StateSnapshot } {
  const issues: StoryIssue[] = [];
  const add = (category: StoryCategory, reference: string, evidence: string, correction: string) =>
    issues.push(issue(c.id, category, reference, evidence, correction));
  const values = { ...previous.values },
    sources = { ...previous.sources };
  if (scene.id !== c.id || scene.blueprintVersion !== p.blueprint.version)
    add(
      "structure",
      c.id,
      "Scene ID or blueprint version differs",
      "Use the exact scene contract and blueprint version.",
    );
  const known = new Set(p.blueprint.entities.map((e) => e.id));
  for (const eid of scene.entityIds)
    if (!known.has(eid)) add("structure", eid, "Unknown entity", "Use a canonical entity ID.");
  for (const eid of [...c.characterIds, c.locationId, ...c.entityIds])
    if (!scene.entityIds.includes(eid))
      add("instructions", eid, "Required entity missing", "Include the required entity.");
  for (const eid of scene.eventIds)
    if (p.blueprint.entities.find((e) => e.id === eid)?.kind !== "event")
      add("structure", eid, "Unknown event", "Use a canonical event ID.");
  for (const eid of c.requiredEvents)
    if (!scene.eventIds.includes(eid))
      add("story", eid, "Required event missing", "Complete the required story beat.");
  for (const f of c.fields)
    if (f === "dialogue" ? !scene.dialogue.length : !scene[f].trim())
      add(
        f === "dialogue" ? "dialogue" : f === "visual" ? "visual" : "instructions",
        f,
        "Required field empty",
        "Supply the required scene field.",
      );
  for (const d of scene.dialogue)
    if (!c.characterIds.includes(d.characterId))
      add("dialogue", d.characterId, d.line, "Only a present canonical character may speak.");
  for (const f of p.blueprint.canonical.filter((f) => scene.entityIds.includes(f.entityId))) {
    const asserted = scene.canonicalFacts.find((a) => a.factId === f.id);
    if (!asserted || asserted.value !== f.value)
      add(
        "visual",
        f.id,
        asserted?.value ?? "Canonical fact omitted",
        `Preserve ${f.field}: ${f.value}.`,
      );
  }
  for (const f of scene.canonicalFacts)
    if (!p.blueprint.canonical.some((a) => a.id === f.factId))
      add("structure", f.factId, "Unknown canonical fact", "Use an existing canonical fact ID.");
  for (const f of c.before)
    if (values[stateKey(f.entityId, f.field)] !== f.value)
      add(
        "continuity",
        `${f.entityId}.${f.field}`,
        "Validated boundary differs from scene precondition",
        "Repair this scene's transition or its prerequisite.",
      );
  const changed = new Set<string>();
  for (const change of scene.changes) {
    const key = stateKey(change.entityId, change.field);
    const canonical = p.blueprint.canonical.find(
      (f) => f.entityId === change.entityId && f.field === change.field,
    );
    if (
      !known.has(change.entityId) ||
      !scene.entityIds.includes(change.entityId) ||
      changed.has(key) ||
      (values[key] ?? null) !== change.from ||
      (canonical && canonical.value !== change.to) ||
      !change.evidence.trim() ||
      ![scene.action, scene.visual, ...scene.dialogue.map((d) => d.line)].some((s) =>
        s.includes(change.evidence),
      )
    ) {
      add(
        "continuity",
        key,
        change.evidence,
        "Supply one evidence-linked transition from the actual validated state; never change immutable facts.",
      );
      continue;
    }
    changed.add(key);
    values[key] = change.to;
    sources[key] = { sceneId: c.id, evidence: change.evidence };
  }
  for (const f of c.after)
    if (values[stateKey(f.entityId, f.field)] !== f.value)
      add(
        "continuity",
        `${f.entityId}.${f.field}`,
        `Expected ${f.value}; got ${values[stateKey(f.entityId, f.field)] ?? "unset"}`,
        "Show the required state change with evidence.",
      );
  return { issues, candidate: { sceneId: c.id, values, sources } };
}

export function dependentScenes(p: StoryPlan, changed: string[]): string[] {
  const affected = new Set(changed);
  let size = -1;
  while (size !== affected.size) {
    size = affected.size;
    for (const s of p.manifest) if (s.dependsOn.some((d) => affected.has(d))) affected.add(s.id);
  }
  return p.manifest.filter((s) => affected.has(s.id)).map((s) => s.id);
}

export type StoryAdapter = {
  model: string;
  provider: string;
  contextTokens: number;
  outputTokens: number;
  headroomTokens: number;
  schemaMode: "normalized-json";
  tokenization: string;
  countTokens(text: string): number;
};
/** Fast conservative token estimate (UTF-8 bytes bound multilingual input).
 *  A pure-JS BPE tokenizer was removed: encoding every large story context burned the
 *  Worker's CPU budget and killed long story runs with "Worker exceeded CPU time limit". */
export function storyAdapter(model: string, provider: string): StoryAdapter {
  const gpt = /gpt-oss/.test(model);
  // Published provider context limits; output remains the existing configured 8k allowance.
  // Unknown adapters stay conservative and never inherit another provider's capabilities.
  const contextTokens = provider === "groq" && gpt ? 131072 : provider === "cf" && gpt ? 128000 : provider === "nvidia" && /nemotron-3-super/.test(model) ? 1000000 : provider === "nvidia" && /nano-omni/.test(model) ? 262144 : 32768;
  return {
    model,
    provider,
    contextTokens,
    outputTokens: 8192,
    headroomTokens: 2048,
    schemaMode: "normalized-json",
    tokenization: "UTF-8 byte upper bound (not provider usage)",
    countTokens: (s) => new TextEncoder().encode(s).length,
  };
}
export function budgetStoryMessages(
  messages: ChatMsg[],
  adapter: StoryAdapter,
): { messages: ChatMsg[]; tokens: number; omitted: string[] } {
  const tokens = messages.reduce(
    (n, m) => n + adapter.countTokens(JSON.stringify(m.content)) + 16,
    0,
  );
  if (tokens + adapter.outputTokens + adapter.headroomTokens > adapter.contextTokens)
    throw new Error(
      `Required story context exceeds the configured safe token budget for ${adapter.model}; no required facts were truncated (${tokens} input tokens/upper bound).`,
    );
  return { messages, tokens, omitted: [] };
}

export const reviewSchema = z.object({
  checks: z.object(
    Object.fromEntries(STORY_CATEGORIES.map((c) => [c, z.boolean()])) as Record<
      StoryCategory,
      z.ZodBoolean
    >,
  ),
  issues: z.array(
    z.object({
      severity: z.enum(["critical", "warning"]),
      category: z.enum(STORY_CATEGORIES),
      sceneId: text,
      reference: text,
      evidence: text,
      correction: text,
    }),
  ),
});
export type StoryReview = z.infer<typeof reviewSchema>;
export function parseStoryJson<T>(raw: string, schema: z.ZodType<T>): T {
  const clean = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return schema.parse(JSON.parse(clean));
}
