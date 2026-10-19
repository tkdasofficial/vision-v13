// The worker statuses shown in chat. Each maps to a real backend operation — never simulated.
// "THINKING" is always the first status of a task (the server emits it first); the rest appear only
// when the matching operation actually runs.
import type { JobStatus } from "@/lib/builder/statuses";
import type { TaskStage } from "@/lib/ai/task-events";

/** The only worker-status labels a chat reply may show. */
export const WORK_STATES = [
  "THINKING", "REMEMBERING", "SAVING_MEMORY", "UPDATING_MEMORY", "DELETING_MEMORY",
  "REASONING", "SEARCHING", "FETCHING", "READING", "BROWSING", "FINDING", "ANALYZING",
  "PLANNING", "WRITING", "DRAFTING", "REDRAFTING", "EDITING", "SUMMARIZING", "TRANSLATING", "REVIEWING",
  "DEEP_THINKING", "ORGANIZING", "CRAFTING", "DESIGNING", "FORMATTING",
  "WORKING", "IMPORTING", "SAVING", "UPDATING", "DELETING", "COMPRESSING", "EXTRACTING",
  "EXECUTING", "INITIALIZING", "DEBUGGING", "FIXING", "OPTIMIZING", "REFACTORING", "CLEANING",
  "VALIDATING", "CALLING_TOOL", "QUERYING", "RETRYING", "FINALIZING",
  "QUEUED", "WAITING_FOR_INPUT", "UNAVAILABLE", "SKIPPED", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED",
] as const;
export type WorkState = (typeof WORK_STATES)[number];

/** Every streamed task stage, folded into one worker status (null = never shown). */
const STAGE_STATE: Record<TaskStage, WorkState | null> = {
  thinking: "THINKING",
  understanding_request: "THINKING",
  retrieving_context: "FINDING",
  planning: "PLANNING",
  writing: "WRITING",
  analyzing_requirements: "ANALYZING",
  reasoning: "REASONING",
  searching_web: "SEARCHING",
  reading_sources: "READING",
  gathering_information: "SEARCHING",
  comparing_sources: "ANALYZING",
  fact_checking: "VALIDATING",
  extracting_information: "READING",
  processing: "EXECUTING",
  analyzing_files: "ANALYZING",
  processing_data: "ANALYZING",
  calculating: "EXECUTING",
  executing_code: "EXECUTING",
  running_tests: "VALIDATING",
  generating_file: "WORKING",
  converting_file: "WORKING",
  reviewing_answer: "REVIEWING",
  verifying_accuracy: "VALIDATING",
  checking_completeness: "VALIDATING",
  validating_requirements: "VALIDATING",
  detecting_issues: "VALIDATING",
  fixing_issues: "FIXING",
  retrying: "RETRYING",
  building_output: "WORKING",
  preparing_output: "FINALIZING",
  finalizing: "FINALIZING",
  switching_provider: null, // backend-only routing
  failed: "FAILED",
  cancelled: "CANCELLED",
  remembering: "REMEMBERING",
  saving_memory: "SAVING_MEMORY",
  updating_memory: "UPDATING_MEMORY",
  deleting_memory: "DELETING_MEMORY",
  fetching: "FETCHING",
  finding: "FINDING",
  browsing: "BROWSING",
  deep_thinking: "DEEP_THINKING",
  working: "WORKING",
  editing: "EDITING",
  drafting: "DRAFTING",
  redrafting: "REDRAFTING",
  summarizing: "SUMMARIZING",
  translating: "TRANSLATING",
  reviewing: "REVIEWING",
  organizing: "ORGANIZING",
  crafting: "CRAFTING",
  designing: "DESIGNING",
  formatting: "FORMATTING",
  importing: "IMPORTING",
  saving: "SAVING",
  updating: "UPDATING",
  deleting: "DELETING",
  compressing: "COMPRESSING",
  initializing: "INITIALIZING",
  debugging: "DEBUGGING",
  optimizing: "OPTIMIZING",
  refactoring: "REFACTORING",
  cleaning: "CLEANING",
  querying: "QUERYING",
  calling_tool: "CALLING_TOOL",
  waiting_for_input: "WAITING_FOR_INPUT",
  unavailable: "UNAVAILABLE",
  skipped: "SKIPPED",
  blocked: "BLOCKED",
  queued: "QUEUED",
};

/** Every job status, folded into one worker status (absent = terminal; the job card shows its own outcome). */
const JOB_STATE: Partial<Record<JobStatus, WorkState>> = {
  queued: "QUEUED",
  dispatched: "QUEUED",
  running: "EXECUTING",
  thinking: "THINKING",
  planning: "PLANNING",
  analyzing: "ANALYZING",
  inspecting: "READING",
  extracting: "EXTRACTING",
  scanning: "ANALYZING",
  indexing: "EXECUTING",
  generating: "WORKING",
  writing_files: "WORKING",
  setting_up: "INITIALIZING",
  validating: "VALIDATING",
  running_checks: "VALIDATING",
  debugging: "DEBUGGING",
  fixing: "FIXING",
  compressing: "COMPRESSING",
  packaging: "WORKING",
  verifying: "VALIDATING",
  uploading: "SAVING",
  downloading: "FETCHING",
  processing: "EXECUTING",
  saving: "SAVING",
  retrying: "RETRYING",
  writing_content: "WRITING",
  creating_document: "WORKING",
  converting_file: "WORKING",
  validating_output: "VALIDATING",
  saving_file: "SAVING",
  fetching: "FETCHING",
  calling_tool: "CALLING_TOOL",
  skipped: "SKIPPED",
};

/** Worker status for a streamed task stage; null when it must not appear in the UI. */
export function workStateForStage(stage: TaskStage): WorkState | null {
  return STAGE_STATE[stage] ?? null;
}

/** Worker status for a backend job status. */
export function workStateForJob(status: JobStatus): WorkState | null {
  return JOB_STATE[status] ?? null;
}

/** Exact display labels for states whose name is not a plain capitalized word. */
const STATE_LABEL: Partial<Record<WorkState, string>> = {
  SAVING_MEMORY: "Saving Memory",
  UPDATING_MEMORY: "Updating Memory",
  DELETING_MEMORY: "Deleting Memory",
  DEEP_THINKING: "Deep Thinking",
  CALLING_TOOL: "Calling Tool",
  WAITING_FOR_INPUT: "Waiting for Input",
  QUERYING: "Query",
};

/** Display form: first letter capital, rest lowercase ("THINKING" → "Thinking"). */
export function workStateLabel(state: WorkState | null | undefined): string | undefined {
  if (!state) return undefined;
  return STATE_LABEL[state] ?? state.charAt(0) + state.slice(1).toLowerCase();
}

/** A completed reply's persistent activity record: real elapsed seconds plus what actually ran. */
export type ActivitySummary = { seconds: number; steps: string[] };

/**
 * Folds a reply's recorded task stages into a display history: hidden stages dropped,
 * consecutive duplicates merged, labels in display form. Returns null when nothing real ran —
 * the UI shows no activity row rather than a fabricated one. Seconds come from the caller's
 * real measurement, never estimated here.
 */
export function activitySummary(stages: TaskStage[], seconds: number): ActivitySummary | null {
  const steps: string[] = [];
  for (const stage of stages) {
    const label = workStateLabel(workStateForStage(stage));
    if (!label || label === "Completed") continue;
    if (steps[steps.length - 1] !== label) steps.push(label);
  }
  if (!steps.length) return null;
  return { seconds: Math.max(0, Math.round(seconds)), steps };
}

// Deep Thinking stages use their own names; map them to the same worker-status labels.
const DEEP_STAGE_STATE: Record<string, WorkState | null> = {
  thinking: "THINKING",
  analyzing: "ANALYZING",
  planning: "PLANNING",
  researching: "SEARCHING",
  reading: "READING",
  working: "EXECUTING",
  generating: "WRITING",
  verifying: "VALIDATING",
  correcting: "FIXING",
  validating: "VALIDATING",
  crafting: "WRITING",
  retrying: "RETRYING",
  remembering: "REMEMBERING",
  saving_memory: "SAVING_MEMORY",
  updating_memory: "UPDATING_MEMORY",
  deleting_memory: "DELETING_MEMORY",
  switching_provider: null,
  done: "COMPLETED",
  failed: "FAILED",
};

/** Same folding as activitySummary, for Deep Thinking replies' real stage history. */
export function deepActivitySummary(stages: string[], seconds: number): ActivitySummary | null {
  const steps: string[] = [];
  for (const stage of stages) {
    const label = workStateLabel(DEEP_STAGE_STATE[stage]);
    if (!label || label === "Completed") continue;
    if (steps[steps.length - 1] !== label) steps.push(label);
  }
  if (!steps.length) return null;
  return { seconds: Math.max(0, Math.round(seconds)), steps };
}
