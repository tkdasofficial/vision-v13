import { extractSource } from "@/lib/ai/references";
import type { JobView } from "./statuses";

/** Success alone is not delivery: a registered download must exist. */
export function hasDeliveredFile(job: JobView): boolean {
  return (job.status === "completed" || job.status === "completed_with_warnings") && job.artifacts.length > 0;
}

/** Only the request can opt in; referenced file/story text is never an instruction. */
export function wantsFileContents(prompt: string): boolean {
  const request = extractSource(prompt)?.request ?? prompt.split("<<<SOURCE")[0];
  const clauses = request.split(/[.!?;\n]|\bbut\b/i);
  const show = /\b(?:show|display|print|paste|include|expose|reveal|preview)\b[^.!?;\n]{0,80}\b(?:contents?|text|code|what\s+(?:you\s+)?(?:created|wrote|made)|what(?:'s|\s+is)\s+inside)\b/i;
  const directives = clauses.filter((clause) => show.test(clause));
  const last = directives.at(-1);
  return !!last && !/\b(?:don['’]?t|do\s+not|never|without|no\s+need\s+to)\b/i.test(last);
}

/** Applies to current results and restored jobs, including expired download references. */
export function isFileDelivery(job: JobView): boolean {
  return job.artifacts.length > 0 || job.type === "code_export" || job.type === "project_generate" || job.type === "long_context"
    || !!job.result?.steps?.some((step: { artifacts?: unknown[] }) => step.artifacts?.length);
}

export function canShowJobContents(job: JobView): boolean {
  return !isFileDelivery(job) || wantsFileContents(String(job.result?.prompt ?? ""));
}