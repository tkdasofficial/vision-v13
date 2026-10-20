import { describe, expect, it } from "vitest";
import { runtimeStageStep } from "@/lib/runtime/progress";
import { workStateForJob } from "@/lib/ai/work-status";

describe("actual runtime stages", () => {
  it("distinguishes story planning, writing, repairs, checks and assembly", () => {
    expect(runtimeStageStep("planning")).toEqual(["planning", "Planning the story blueprint"]);
    expect(runtimeStageStep("writing_story")?.[0]).toBe("writing_content");
    expect(runtimeStageStep("writing_scene_100")).toEqual(["writing_content", "Writing scene 100"]);
    expect(runtimeStageStep("retrying_scene_2")?.[0]).toBe("retrying");
    expect(runtimeStageStep("correcting_scene_2")?.[0]).toBe("fixing");
    expect(runtimeStageStep("validating_scene_2")?.[0]).toBe("validating_output");
    expect(runtimeStageStep("assembling")?.[0]).toBe("packaging");
  });
  it("never infers terminal execution from runner startup, file processing or unknown stages", () => {
    for (const stage of ["claimed", "processing", "planning", "writing_scene_1"]) {
      const mapped = runtimeStageStep(stage);
      expect(mapped).not.toBeNull();
      if (mapped) expect(workStateForJob(mapped[0])).not.toBe("EXECUTING");
    }
    expect(runtimeStageStep("terminal")).toBeNull();
    expect(runtimeStageStep("invented_stage")).toBeNull();
  });
});