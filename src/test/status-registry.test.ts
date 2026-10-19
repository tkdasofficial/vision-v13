import { describe, expect, it } from "vitest";
import { STAGE_LABELS, type TaskStage } from "@/lib/ai/task-events";
import { JOB_STATUSES, isTerminal, type JobStatus } from "@/lib/builder/statuses";
import { WORK_STATES, workStateForJob, workStateForStage, workStateLabel } from "@/lib/ai/work-status";

describe("complete status registry", () => {
  it("gives every task stage a label and a displayable or explicitly hidden state", () => {
    for (const stage of Object.keys(STAGE_LABELS) as TaskStage[]) {
      expect(STAGE_LABELS[stage].length).toBeGreaterThan(0);
      const state = workStateForStage(stage);
      if (state === null) expect(stage).toBe("switching_provider");
      else expect(WORK_STATES).toContain(state);
    }
  });

  it("gives every non-terminal job status a displayable or explicitly hidden state", () => {
    for (const status of Object.keys(JOB_STATUSES) as JobStatus[]) {
      if (isTerminal(status)) { expect(workStateForJob(status)).toBeNull(); continue; }
      const state = workStateForJob(status);
      if (state === null) expect(status).toBe("switching_provider");
      else expect(WORK_STATES).toContain(state);
    }
  });

  it("renders a non-empty label for every showable state", () => {
    for (const state of WORK_STATES) expect(workStateLabel(state)).toBeTruthy();
  });

  it("keeps permanent-memory statuses distinct from temporary-context statuses", () => {
    expect(workStateForStage("saving_memory")).not.toBe(workStateForStage("saving"));
    expect(workStateForStage("updating_memory")).not.toBe(workStateForStage("updating"));
    expect(workStateForStage("deleting_memory")).not.toBe(workStateForStage("deleting"));
  });

  it("uses Working for file generation and never a Creating status", () => {
    expect(workStateForStage("generating_file")).toBe("WORKING");
    expect(workStateForStage("converting_file")).toBe("WORKING");
    expect(workStateForJob("creating_document")).toBe("WORKING");
    expect(WORK_STATES).not.toContain("CREATING");
    expect(WORK_STATES).not.toContain("GENERATING");
  });
});
