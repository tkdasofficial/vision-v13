import type { JobView } from "@/lib/builder/statuses";

/** Hide internal routing while retaining the last actual user-facing operation. */
export function visibleJobStatus(job: JobView) {
  const steps = job.steps.filter((step) => step.status !== "switching_provider");
  if (job.status !== "switching_provider") return { status: job.status, detail: job.error ?? job.detail, steps };
  const previous = steps.at(-1);
  return { status: previous?.status ?? "processing", detail: previous?.detail, steps };
}