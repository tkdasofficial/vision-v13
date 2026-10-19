import type { ChatMessage } from "@/lib/types";
import { hasDeliveredFile } from "./file-delivery";
import { isTerminal, type JobView } from "./statuses";

/** One owner-scoped task remains one reply, including after a failed status request. */
export function mergeChatJobs(messages: ChatMessage[], jobs: JobView[]): ChatMessage[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const result = messages.map((message) => {
    // Server-saved runtime replies and restored jobs share one durable identity.
    const latest = byId.get(message.job?.id ?? (message.id.startsWith("job-") ? message.id.slice(4) : ""));
    if (!latest || message.archivedJob) return message;
    byId.delete(latest.id);
    if (Date.parse(latest.updatedAt) < Date.parse(message.job?.updatedAt ?? "")) return message;
    const content = typeof latest.result?.content === "string" && latest.result.content === message.content ? "" : message.content;
    return { ...message, content, job: latest };
  });
  for (const job of byId.values()) result.push({
    id: `job-${job.id}`, role: "assistant", timestamp: new Date(job.createdAt), job,
    content: !isTerminal(job.status) ? "" : job.status === "failed" || job.status === "timed_out"
      ? `That didn't work: ${job.error ?? "unknown error"}` : job.status === "cancelled" ? "Task cancelled."
      : hasDeliveredFile(job) ? "Here's your file." : "",
  });
  const key = (message: ChatMessage) => new Date(message.timestamp).getTime() + (message.job ? 8000 : 0);
  return result.sort((a, b) => key(a) - key(b));
}

/** Network errors never mean the accepted task stopped. Only a real 404 or terminal view ends following. */
export async function followJob(
  id: string,
  read: (id: string) => Promise<JobView | null>,
  update: (job: JobView) => void,
  stopped: () => boolean,
  pause: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 2000)),
) {
  while (!stopped()) {
    try {
      const job = await read(id);
      if (stopped()) return;
      if (!job) return;
      update(job);
      if (isTerminal(job.status)) return;
    } catch { /* temporarily offline: retain the saved view and reconnect */ }
    await pause();
  }
}