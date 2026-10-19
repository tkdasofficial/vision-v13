// Controlled status vocabulary for jobs. Each value maps to a real backend operation.
export const JOB_STATUSES = {
  queued: "Queued",
  dispatched: "Waiting for Runner",
  running: "Running",
  thinking: "Thinking",
  planning: "Planning",
  analyzing: "Analyzing",
  inspecting: "Inspecting",
  extracting: "Extracting",
  scanning: "Scanning",
  indexing: "Indexing",
  generating: "Generating",
  writing_files: "Writing Files",
  setting_up: "Setting Up",
  validating: "Validating",
  running_checks: "Running Checks",
  debugging: "Debugging",
  fixing: "Fixing",
  compressing: "Compressing",
  packaging: "Packaging",
  verifying: "Verifying",
  uploading: "Uploading",
  downloading: "Fetching",
  processing: "Processing",
  saving: "Saving",
  retrying: "Retrying",
  switching_provider: "Switching AI provider",
  writing_content: "Writing content",
  creating_document: "Creating document",
  converting_file: "Converting file",
  validating_output: "Validating output",
  saving_file: "Saving file",
  fetching: "Fetching",
  calling_tool: "Calling Tool",
  skipped: "Skipped",
  completed: "Completed",
  completed_with_warnings: "Completed with Warnings",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed Out",
} as const;

export type JobStatus = keyof typeof JOB_STATUSES;
export const TERMINAL: JobStatus[] = ["completed", "completed_with_warnings", "failed", "cancelled", "timed_out"];
export const isTerminal = (s: JobStatus) => TERMINAL.includes(s);

export type JobStep = { status: JobStatus; detail: string; at: string; endedAt?: string; outcome?: "ok" | "warn" | "error" };
export type JobType = "code_export" | "project_generate" | "zip_analyze" | "agent_task" | "runtime_task" | "long_context";

export type ArtifactRef = { id: string; name: string; size: number; kind: "file" | "zip" | "report" };

export type JobView = {
  id: string;
  type: JobType;
  status: JobStatus;
  detail: string;
  progress: number | null; // only set when measurable
  steps: JobStep[];
  warnings: string[];
  error: string | null;
  result: any;
  artifacts: ArtifactRef[];
  sessionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A running job whose worker stopped reporting for this long is treated as interrupted. */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export function recoveredStatus(status: JobStatus, updatedAt: string, now = Date.now()): JobStatus {
  if (isTerminal(status)) return status;
  return now - Date.parse(updatedAt) > STALE_AFTER_MS ? "failed" : status;
}
