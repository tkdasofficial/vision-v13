import type { StoryPlan, StoryScene } from "@/lib/ai/deep/story";
export function storyFixture(count: number): StoryPlan {
  return {
    requirements: [
      { id: "R1", text: "Ari carries a red lantern throughout the journey.", mandatory: true },
    ],
    defaults: [],
    blueprint: {
      version: 1,
      premise: "Ari brings light home.",
      arc: "Depart, travel, return.",
      worldRules: [],
      visualStyle: "Ink illustration",
      dialogueStyle: "Brief",
      entities: [
        { id: "C1", kind: "character", name: "Ari", profile: "Courier" },
        { id: "L1", kind: "location", name: "Road", profile: "A winding road" },
        { id: "P1", kind: "prop", name: "Lantern", profile: "Red lantern" },
      ],
      canonical: [{ id: "F1", entityId: "P1", field: "colour", value: "red", requirementId: "R1" }],
      initialState: [{ entityId: "C1", field: "possession", value: "P1" }],
      timelineRules: ["Chronological"],
      continuityConstraints: ["The lantern stays with Ari"],
    },
    manifest: Array.from({ length: count }, (_, i) => ({
      id: `S${i + 1}`,
      order: i + 1,
      purpose: `Journey beat ${i + 1}`,
      locationId: "L1",
      characterIds: ["C1"],
      entityIds: ["C1", "L1", "P1"],
      requiredEvents: [],
      emotionalBeat: "Hope",
      dependsOn: i ? [`S${i}`] : [],
      requirementIds: ["R1"],
      before: [{ entityId: "C1", field: "possession", value: "P1" }],
      after: [{ entityId: "C1", field: "possession", value: "P1" }],
      fields: ["action", "visual", "environment"],
    })),
  };
}
export function sceneFixture(id: string): StoryScene {
  return {
    id,
    blueprintVersion: 1,
    entityIds: ["C1", "L1", "P1"],
    eventIds: [],
    action: "Ari walks forward with the red lantern.",
    visual: "Ari holds a red lantern.",
    dialogue: [],
    environment: "A winding road.",
    camera: "",
    canonicalFacts: [{ factId: "F1", value: "red" }],
    changes: [],
    metadata: { timeline: "Later", emotionalBeat: "Hope" },
  };
}
export const passReview = {
  checks: {
    story: true,
    visual: true,
    dialogue: true,
    continuity: true,
    instructions: true,
    structure: true,
  },
  issues: [],
};
