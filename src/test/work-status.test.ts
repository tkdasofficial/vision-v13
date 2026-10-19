import { describe, it, expect } from "vitest";
import { WORK_STATES, workStateForJob, workStateForStage } from "@/lib/ai/work-status";
import { STAGE_LABELS, type TaskStage } from "@/lib/ai/task-events";
import { JOB_STATUSES, isTerminal, type JobStatus } from "@/lib/builder/statuses";

describe("chat worker statuses", () => {
  it("uses exactly the approved status registry", () => {
    expect([...WORK_STATES]).toEqual([
      "THINKING", "REMEMBERING", "SAVING_MEMORY", "UPDATING_MEMORY", "DELETING_MEMORY",
      "REASONING", "SEARCHING", "FETCHING", "READING", "BROWSING", "FINDING", "ANALYZING",
      "PLANNING", "WRITING", "DRAFTING", "REDRAFTING", "EDITING", "SUMMARIZING", "TRANSLATING", "REVIEWING",
      "DEEP_THINKING", "ORGANIZING", "CRAFTING", "DESIGNING", "FORMATTING",
      "WORKING", "IMPORTING", "SAVING", "UPDATING", "DELETING", "COMPRESSING", "EXTRACTING",
      "EXECUTING", "INITIALIZING", "DEBUGGING", "FIXING", "OPTIMIZING", "REFACTORING", "CLEANING",
      "VALIDATING", "CALLING_TOOL", "QUERYING", "RETRYING", "FINALIZING",
      "QUEUED", "WAITING_FOR_INPUT", "UNAVAILABLE", "SKIPPED", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED",
    ]);
  });

  it("never includes a rejected status label", () => {
    for (const rejected of ["Creating", "Downloading", "Responding", "Answering", "Explaining", "Improving"]) {
      expect(Object.values(STAGE_LABELS)).not.toContain(rejected);
      expect(Object.values(JOB_STATUSES)).not.toContain(rejected);
    }
  });

  it("folds every streamed stage into an agreed status and hides provider switching", () => {
    for (const stage of Object.keys(STAGE_LABELS) as TaskStage[]) {
      const state = workStateForStage(stage);
      if (state) expect(WORK_STATES).toContain(state);
    }
    expect(workStateForStage("switching_provider")).toBeNull();
  });

  it("maps real operations to their status", () => {
    expect(workStateForStage("thinking")).toBe("THINKING");
    expect(workStateForStage("retrieving_context")).toBe("FINDING");
    expect(workStateForStage("writing")).toBe("WRITING");
    expect(workStateForStage("reading_sources")).toBe("READING");
    expect(workStateForStage("fixing_issues")).toBe("FIXING");
    // File generation shows "Working", never a writing or generic generating status.
    expect(workStateForStage("generating_file")).toBe("WORKING");
    expect(workStateForJob("creating_document")).toBe("WORKING");
    expect(workStateForJob("converting_file")).toBe("WORKING");
    expect(workStateForJob("validating_output")).toBe("VALIDATING");
    expect(workStateForJob("queued")).toBe("QUEUED");
    // Memory statuses are distinct from temporary-context statuses.
    expect(workStateForStage("saving_memory")).toBe("SAVING_MEMORY");
    expect(workStateForStage("updating_memory")).toBe("UPDATING_MEMORY");
    expect(workStateForStage("deleting_memory")).toBe("DELETING_MEMORY");
    expect(workStateForStage("remembering")).toBe("REMEMBERING");
    expect(workStateForStage("saving")).toBe("SAVING");
    expect(workStateForStage("updating")).toBe("UPDATING");
    expect(workStateForStage("deleting")).toBe("DELETING");
    // Tool/integration statuses map to their real operations.
    expect(workStateForStage("calling_tool")).toBe("CALLING_TOOL");
    expect(workStateForJob("calling_tool")).toBe("CALLING_TOOL");
    expect(workStateForJob("fetching")).toBe("FETCHING");
    expect(workStateForJob("skipped")).toBe("SKIPPED");
    expect(workStateForJob("downloading")).toBe("FETCHING");
    expect(workStateForStage("waiting_for_input")).toBe("WAITING_FOR_INPUT");
    expect(workStateForStage("blocked")).toBe("BLOCKED");
    expect(workStateForStage("unavailable")).toBe("UNAVAILABLE");
  });

  it("never shows a working status for a finished job", () => {
    const terminal = (Object.keys(JOB_STATUSES) as JobStatus[]).filter(isTerminal);
    for (const status of terminal) expect(workStateForJob(status)).toBeNull();
  });
});

import { workStateLabel } from "@/lib/ai/work-status";
describe("status display", () => {
  it("shows sentence case", () => { expect(workStateLabel("THINKING")).toBe("Thinking"); expect(workStateLabel("REASONING")).toBe("Reasoning"); });
  it("shows exact multi-word labels", () => {
    expect(workStateLabel("SAVING_MEMORY")).toBe("Saving Memory");
    expect(workStateLabel("DELETING_MEMORY")).toBe("Deleting Memory");
    expect(workStateLabel("DEEP_THINKING")).toBe("Deep Thinking");
    expect(workStateLabel("CALLING_TOOL")).toBe("Calling Tool");
    expect(workStateLabel("WAITING_FOR_INPUT")).toBe("Waiting for Input");
    expect(workStateLabel("QUERYING")).toBe("Query");
    expect(workStateLabel("WORKING")).toBe("Working");
  });
});

import { activitySummary } from "@/lib/ai/work-status";

describe("activitySummary (Task 4 activity history)", () => {
  it("keeps only stages that really ran, in display form", () => {
    const a = activitySummary(["thinking", "searching_web", "writing", "finalizing"] as any, 42.4);
    expect(a).toEqual({ seconds: 42, steps: ["Thinking", "Searching", "Writing", "Finalizing"] });
  });
  it("merges consecutive duplicates and drops hidden stages", () => {
    const a = activitySummary(["thinking", "thinking", "switching_provider", "validating_requirements", "reviewing_answer"] as any, 5);
    expect(a!.steps).toEqual(["Thinking", "Validating", "Reviewing"]);
  });
  it("returns null when nothing displayable ran — never fabricates activity", () => {
    expect(activitySummary(["switching_provider"] as any, 3)).toBeNull();
    expect(activitySummary([], 3)).toBeNull();
  });
  it("uses the real measured seconds, never negative", () => {
    expect(activitySummary(["thinking"] as any, -2)!.seconds).toBe(0);
    expect(activitySummary(["thinking"] as any, 7.6)!.seconds).toBe(8);
  });
});

import { deepActivitySummary } from "@/lib/ai/work-status";

describe("deepActivitySummary", () => {
  it("maps deep stages to the same worker labels, dropping hidden ones", () => {
    const a = deepActivitySummary(["analyzing", "researching", "crafting", "verifying", "done"], 12.4);
    expect(a).toEqual({ seconds: 12, steps: ["Analyzing", "Searching", "Writing", "Validating"] });
  });
  it("returns null when only hidden stages ran", () => {
    expect(deepActivitySummary(["switching_provider"], 3)).toBeNull();
  });
});
