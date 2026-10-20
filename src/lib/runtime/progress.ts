import type { JobStatus } from "@/lib/builder/statuses";

/** Recorded runtime operations, not a simulated sequence or an inferred terminal run. */
export function runtimeStageStep(stage: string): [JobStatus, string] | null {
  const stages: Record<string, [JobStatus, string]> = {
    claimed: ["running", "Runner started"],
    validating_input: ["validating", "Checking the file on the runner"],
    processing: ["processing", "Processing the file"],
    validating_output: ["verifying", "Validating the output"],
    uploading_output: ["uploading", "Preparing the download"],
    planning: ["planning", "Planning the story blueprint"],
    writing_story: ["writing_content", "Writing the story"],
    retrying_story: ["retrying", "Correcting the story format"],
    validating_story: ["validating_output", "Checking the story format"],
    assembling: ["packaging", "Assembling the final document"],
  };
  if (stages[stage]) return stages[stage];
  const scene = stage.match(/^(writing|retrying|correcting|validating)_scene_(\d+)$/);
  if (!scene) return null;
  const status: JobStatus = scene[1] === "writing" ? "writing_content" : scene[1] === "retrying" ? "retrying" : scene[1] === "correcting" ? "fixing" : "validating_output";
  const verb = scene[1] === "writing" ? "Writing" : scene[1] === "retrying" ? "Regenerating" : scene[1] === "correcting" ? "Correcting" : "Checking";
  return [status, `${verb} scene ${Number(scene[2])}`];
}