import { describe, it, expect, vi } from "vitest";
import { storyFixture, sceneFixture, passReview } from "./fixtures/story-prd";
import {
  validateStoryPlan,
  validateScene,
  initialSnapshot,
  dependentScenes,
  budgetStoryMessages,
  storyAdapter,
  storyPlanSchema,
  sceneSchema,
  stateKey,
} from "@/lib/ai/deep/story";
import { runStructuredStory, type StoryRun, type StoryStore } from "@/lib/ai/deep/story-run";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import type { ModelCall } from "@/lib/ai/deep/pipeline";
function mockStory(count: number, mutate?: (payload: any, scene: any) => void): ModelCall {
  return vi.fn(async (msgs) => {
    const payload = JSON.parse(String(msgs[1].content));
    if (payload.count)
      return { ok: true as const, text: JSON.stringify(storyFixture(count)), finishReason: "stop" };
    if (String(msgs[0].content).includes("Write one scene")) {
      const scene = sceneFixture(payload.contract.id);
      mutate?.(payload, scene);
      return { ok: true as const, text: JSON.stringify(scene), finishReason: "stop" };
    }
    return { ok: true as const, text: JSON.stringify(passReview), finishReason: "stop" };
  });
}
const options = (count: number, call: ModelCall) => ({
  request: `Write ${count} scenes about Ari carrying a red lantern.`,
  requestId: "story-test-1",
  analysis: analyzeRequest(`Write ${count} scenes`),
  system: "",
  call,
  adapter: storyAdapter("gpt-oss-120b", "groq"),
});
describe("story PRD contracts", () => {
  it("requires requested fields and blocks underlength dialogue before approval", async () => {
    const call = mockStory(1, (_payload, scene) => { scene.dialogue = [{ characterId: "C1", line: "homework ".repeat(24).trim() }]; });
    const request = "Create a story of 1 scene, each scene have 25 to 30 words dialogue, and give me visual prompt & dialogue.";
    const run = await runStructuredStory({ ...options(1, call), request, analysis: analyzeRequest(request), maxRepairs: 0 });
    expect(run.plan?.manifest[0].fields).toEqual(["visual", "dialogue"]);
    expect(run.status).toBe("unresolved");
    expect(run.issues.some((i) => i.reference === "spoken-word-range")).toBe(true);
  });
  it("accepts dialogue in range without counting the visual field", async () => {
    const call = mockStory(1, (_payload, scene) => { scene.dialogue = [{ characterId: "C1", line: "homework ".repeat(27).trim() }]; });
    const request = "Create a story of 1 scene, each scene have 25 to 30 words dialogue, and give me visual prompt & dialogue.";
    const run = await runStructuredStory({ ...options(1, call), request, analysis: analyzeRequest(request) });
    expect(run.status).toBe("passed");
  });
  it("uses provider-specific context limits while keeping configured output headroom", () => {
    expect(storyAdapter("openai/gpt-oss-120b", "groq").contextTokens).toBe(131072);
    expect(storyAdapter("@cf/openai/gpt-oss-120b", "cf").contextTokens).toBe(128000);
    expect(storyAdapter("nvidia/nemotron-3-super-120b-a12b", "nvidia").contextTokens).toBe(1000000);
    expect(storyAdapter("unknown", "unknown").contextTokens).toBe(32768);
    expect(storyAdapter("openai/gpt-oss-120b", "groq").outputTokens).toBe(8192);
  });
  it("requires a complete 50-scene manifest before generation", () => {
    expect(validateStoryPlan(storyFixture(50), 50)).toEqual([]);
    expect(validateStoryPlan(storyFixture(25), 50).some((i) => i.reference === "scene count")).toBe(
      true,
    );
  });
  it("catches schema errors and missing mandatory scene fields", () => {
    expect(sceneSchema.safeParse({ id: "S1" }).success).toBe(false);
    const p = storyFixture(10);
    p.manifest[0].fields = [];
    expect(storyPlanSchema.safeParse(p).success).toBe(false);
  });
  it("preserves blueprints larger than 32000 characters", () => {
    const p = storyFixture(10);
    p.blueprint.arc = "complexity ".repeat(5000);
    expect(storyPlanSchema.parse(p).blueprint.arc).toBe(p.blueprint.arc);
  });
  it("rejects missing mandatory coverage, cycles and contradictory canon", () => {
    const p = storyFixture(3);
    p.manifest.forEach((c) => (c.requirementIds = []));
    p.manifest[0].dependsOn = ["S3"];
    p.blueprint.canonical.push({ ...p.blueprint.canonical[0], id: "F2", value: "blue" });
    const issues = validateStoryPlan(p, 3);
    expect(issues.some((i) => i.reference === "R1")).toBe(true);
    expect(issues.some((i) => i.evidence.includes("cycle"))).toBe(true);
    expect(issues.some((i) => i.evidence.includes("Contradictory"))).toBe(true);
  });
  it("never mutates validated state on contradictory output", () => {
    const p = storyFixture(3),
      initial = initialSnapshot(p),
      s = sceneFixture("S1");
    s.changes = [
      { entityId: "C1", field: "possession", from: "P1", to: "lost", evidence: "not present" },
    ];
    const result = validateScene(p, p.manifest[0], s, initial);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(initial.values[stateKey("C1", "possession")]).toBe("P1");
    expect(initial.sources).toEqual({});
  });
  it("records validated transition provenance from exact evidence", () => {
    const p = storyFixture(3);
    p.manifest[0].after = [{ entityId: "C1", field: "possession", value: "stored" }];
    const s = sceneFixture("S1");
    s.action = "Ari stores the lantern safely.";
    s.changes = [
      { entityId: "C1", field: "possession", from: "P1", to: "stored", evidence: s.action },
    ];
    const v = validateScene(p, p.manifest[0], s, initialSnapshot(p));
    expect(v.issues).toEqual([]);
    expect(v.candidate.sources[stateKey("C1", "possession")]).toEqual({
      sceneId: "S1",
      evidence: s.action,
    });
  });
  it("rejects empty transition evidence even when the proposed state matches", () => {
    const p = storyFixture(1), s = sceneFixture("S1");
    p.manifest[0].after = [{ entityId: "C1", field: "possession", value: "stored" }];
    s.changes = [{ entityId: "C1", field: "possession", from: "P1", to: "stored", evidence: "" }];
    const v = validateScene(p, p.manifest[0], s, initialSnapshot(p));
    expect(v.issues.some((i) => i.category === "continuity")).toBe(true);
    expect(v.candidate.values[stateKey("C1", "possession")]).toBe("P1");
  });
  it("bounds multilingual context by UTF-8 bytes rather than character count", () => {
    const text = "हिन्दी";
    expect(storyAdapter("unknown", "unknown").countTokens(text)).toBe(new TextEncoder().encode(text).length);
    expect(storyAdapter("unknown", "unknown").countTokens(text)).toBeGreaterThan(text.length);
  });
  it("a false review check remains blocking even with only warning issues", async () => {
    const base = mockStory(1);
    const call: ModelCall = async (msgs) => String(msgs[0].content).includes("Independently review")
      ? { ok: true, finishReason: "stop", text: JSON.stringify({ ...passReview, checks: { ...passReview.checks, continuity: false }, issues: [{ severity: "warning", category: "continuity", sceneId: "plan", reference: "R1", evidence: "Not checked", correction: "Check continuity" }] }) }
      : base(msgs);
    const run = await runStructuredStory({ ...options(1, call), maxRepairs: 0 });
    expect(run.status).toBe("unresolved");
    expect(Object.keys(run.scenes)).toHaveLength(0);
  });
  it("passes conversation canon and future beats into scene generation", async () => {
    const call = mockStory(3);
    await runStructuredStory({ ...options(3, call), context: [{ role: "assistant", content: "Ari cannot swim." }] });
    const sceneCalls = vi.mocked(call).mock.calls.filter(([msgs]) => String(msgs[0].content).includes("Write one scene"));
    const payload = JSON.parse(String(sceneCalls[0][0][1].content));
    expect(payload.conversationContext[0].content).toBe("Ari cannot swim.");
    expect(payload.storyOutline.map((s: { id: string }) => s.id)).toEqual(["S1", "S2", "S3"]);
  });
  it("finds transitive dependent scenes only", () => {
    const p = storyFixture(10);
    expect(dependentScenes(p, ["S8"])).toEqual(["S8", "S9", "S10"]);
  });
  it("blocks token overflow without truncation", () => {
    const a = storyAdapter("gpt-oss-120b", "groq");
    a.contextTokens = 30;
    const messages = [{ role: "user" as const, content: "mandatory constraint ".repeat(50) }];
    expect(() => budgetStoryMessages(messages, a)).toThrow(/no required facts were truncated/);
    expect(messages[0].content.length).toBe(1050);
  });
  it("repairs only the failed scene and commits no invalid version", async () => {
    let bad = true;
    const call = mockStory(3, (_payload, s) => {
      if (s.id === "S2" && bad) {
        s.canonicalFacts[0].value = "blue";
        bad = false;
      }
    });
    const run = await runStructuredStory(options(3, call));
    expect(run.status).toBe("passed");
    expect(run.versions.filter((v) => v.sceneId === "S2").map((v) => v.accepted)).toEqual([
      false,
      true,
    ]);
    expect(run.versions.filter((v) => v.sceneId === "S1")).toHaveLength(1);
    expect(run.versions.filter((v) => v.sceneId === "S3")).toHaveLength(1);
    expect(run.scenes.S2.canonicalFacts[0].value).toBe("red");
  });
  it("critical unresolved issues prevent full approval and stop dependent generation", async () => {
    const call = mockStory(3, (_p, s) => {
      if (s.id === "S2") s.canonicalFacts[0].value = "blue";
    });
    const run = await runStructuredStory({ ...options(3, call), maxRepairs: 1 });
    expect(run.status).toBe("unresolved");
    expect(run.scenes.S2).toBeUndefined();
    expect(run.scenes.S3).toBeUndefined();
    expect(run.versions.filter((v) => v.sceneId === "S2")).toHaveLength(2);
    expect(run.issues.some((i) => i.severity === "critical")).toBe(true);
  });
  it("restores approved runs without another provider call", async () => {
    let saved: StoryRun | null = null;
    const store: StoryStore = {
      load: async () => saved,
      save: async (r) => {
        saved = JSON.parse(JSON.stringify(r));
      },
    };
    const call = mockStory(3);
    await runStructuredStory({ ...options(3, call), store });
    const before = vi.mocked(call).mock.calls.length;
    const restored = await runStructuredStory({ ...options(3, call), store });
    expect(restored.status).toBe("passed");
    expect(vi.mocked(call).mock.calls.length).toBe(before);
    expect(restored.audit?.checks.continuity).toBe(true);
  });
  it("global repair rechecks dependents without regenerating unaffected scenes", async () => {
    const base = mockStory(3);
    let audit = 0;
    const call: ModelCall = vi.fn(async (msgs) => {
      const p = JSON.parse(String(msgs[1].content));
      if (p.task === "Final global audit of complete story" && audit++ === 0)
        return {
          ok: true as const,
          text: JSON.stringify({
            ...passReview,
            checks: { ...passReview.checks, continuity: false },
            issues: [
              {
                severity: "critical",
                category: "continuity",
                sceneId: "S2",
                reference: "R1",
                evidence: "S2 needs clarification",
                correction: "Clarify S2",
              },
            ],
          }),
          finishReason: "stop",
        };
      return base(msgs);
    });
    const run = await runStructuredStory(options(3, call));
    expect(run.status).toBe("passed");
    expect(run.versions.filter((v) => v.sceneId === "S2")).toHaveLength(2);
    expect(run.versions.filter((v) => v.sceneId === "S1")).toHaveLength(1);
    expect(run.versions.filter((v) => v.sceneId === "S3")).toHaveLength(1);
    expect(audit).toBe(2);
  });
  it("records provider failures and missing semantic review rather than accepting a scene", async () => {
    const base = mockStory(3);
    const call: ModelCall = async (msgs) =>
      String(msgs[0].content).includes("Independently review")
        ? { ok: false, status: 503, reason: "review unavailable" }
        : base(msgs);
    const run = await runStructuredStory({ ...options(3, call), maxRepairs: 0 });
    expect(run.status).toBe("unresolved");
    expect(run.calls.some((c) => c.error?.includes("503"))).toBe(true);
    expect(Object.keys(run.snapshots)).toHaveLength(0);
  });
  for (const count of [10, 25, 50])
    it(`runs repeatable ${count}-scene contract benchmark (mock model, not accuracy claim)`, async () => {
      const run = await runStructuredStory(options(count, mockStory(count)));
      expect(run.status).toBe("passed");
      expect(Object.keys(run.scenes)).toHaveLength(count);
      expect(run.versions).toHaveLength(count);
      expect(run.calls).toHaveLength(count * 2 + 3);
      expect(run.scores?.structure).toBe(100);
    });
});
