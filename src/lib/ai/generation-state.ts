// Chat generation lifecycle as stored on the server (D1 chat_generations). Pure and browser-safe:
// the server records it, the reopened chat reads it back to restore the live status after a reload.
import { STAGE_LABELS, type TaskStage, type TaskState } from "./task-events";

export type GenerationStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export type GenerationRow = { id: string; chat_id: string | null; status: string; stage: string | null; detail: string | null; history: string | null; error: string | null; updated_at: number; created_at: number };
export type GenerationView = { id: string; chatId: string | null; status: GenerationStatus; stage: TaskStage | null; detail?: string; history: TaskStage[]; error?: string; startedAt: number; updatedAt: number };

/** A running generation sends a heartbeat at least this often; silence beyond the limit means the worker died. */
export const HEARTBEAT_MS = 15_000;
export const STALE_AFTER_MS = 90_000;

const isStage = (s: unknown): s is TaskStage => typeof s === "string" && s in STAGE_LABELS;

/** Turns a stored row into what the client may see; a running row with no heartbeat is reported as interrupted. */
export function viewGeneration(row: GenerationRow, now = Date.now()): GenerationView {
  let history: TaskStage[] = [];
  try { const h = JSON.parse(row.history || "[]"); if (Array.isArray(h)) history = h.filter(isStage); } catch { /* corrupt history: show none */ }
  const known: GenerationStatus[] = ["running", "completed", "failed", "cancelled"];
  let status = (known as string[]).includes(row.status) ? (row.status as GenerationStatus) : "failed";
  if (status === "running" && now - Number(row.updated_at) > STALE_AFTER_MS) status = "interrupted";
  return { id: row.id, chatId: row.chat_id, status, stage: isStage(row.stage) ? row.stage : null, detail: row.detail ?? undefined, history, error: row.error ?? undefined, startedAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

/** Restores the live status line for a generation that is still running. */
export function generationTaskState(v: GenerationView): TaskState | null {
  if (v.status !== "running" || !v.stage) return null;
  return { taskId: v.id, seq: v.history.length, stage: v.stage, message: v.detail, history: v.history.length ? v.history : [v.stage] };
}

/** Records one stage into the stored history (consecutive repeats collapse, provider switches are not stages). */
export function appendStage(history: TaskStage[], stage: TaskStage): TaskStage[] {
  if (stage === "switching_provider") return history;
  return history[history.length - 1] === stage ? history : [...history, stage].slice(-40);
}

/**
 * A question routed to a backend job (file creation, conversion, project) is answered by the job
 * card, never by a chat_messages assistant row or a chat_generations record. The reconnect poller
 * must treat a job created at/after the question as the answer and stop showing "Thinking".
 */
export function questionAnsweredByJob(jobs: { createdAt: string }[], sentAt: number, slackMs = 60_000): boolean {
  return jobs.some((j) => Number.isFinite(Date.parse(j.createdAt)) && Date.parse(j.createdAt) >= sentAt - slackMs);
}

/** User-facing note for a generation that ended without an answer. */
export function endedWithoutAnswer(v: GenerationView): string | null {
  if (v.status === "failed") return v.error ? `The answer couldn't be finished: ${v.error}` : "The answer couldn't be finished. Please try again.";
  if (v.status === "cancelled") return "Stopped.";
  if (v.status === "interrupted") return "The answer was interrupted before it finished. Please try again.";
  return null;
}
