// Main D1 only. Immutable source snapshots and lineage; no extra provider or storage service.
import { d1 } from "@/lib/cloud/d1.server";
import { artifactDescriptor, conversationArtifacts, selectArtifact, selectTask, taskCommand, type ArtifactRecord } from "./intelligence";
import { resolveReference, sourceBlock, extractSource, isContentAction, type ConvMsg } from "./references";

export const INTELLIGENCE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS intelligence_artifacts (id TEXT NOT NULL, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT, artifact_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, root_id TEXT NOT NULL, parent_id TEXT, version INTEGER NOT NULL, operation TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,id))",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_chat ON intelligence_artifacts(user_id,chat_id,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_intelligence_versions ON intelligence_artifacts(user_id,root_id,version)",
];
let ready: Promise<void> | null = null;
export function ensureIntelligence() { return ready ??= (async () => { for (const sql of INTELLIGENCE_SCHEMA) await d1(sql); })().catch((e) => { ready = null; throw e; }); }
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2,"0")).join("");

export async function ownedChat(userId: string, chatId?: string | null) {
  if (!chatId || !/^[\w-]{1,64}$/.test(chatId)) return false;
  return (await d1("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?", [chatId, userId])).length > 0;
}
export async function intelligenceArtifacts(userId: string, chatId: string): Promise<ArtifactRecord[]> {
  if (!await ownedChat(userId, chatId)) return [];
  await ensureIntelligence();
  const rows = await d1<any>("SELECT * FROM intelligence_artifacts WHERE user_id = ? AND chat_id = ? ORDER BY created_at ASC, version ASC LIMIT 500", [userId,chatId]);
  return rows.map((r) => ({ id:r.id, title:r.title,kind:r.kind,content:r.content,rootId:r.root_id,parentId:r.parent_id,version:r.version,chatId:r.chat_id,messageId:r.message_id,artifactId:r.artifact_id }));
}
export async function recordIntelligenceArtifact(userId: string, chatId: string, id: string, content: string, opts: { request?: string; parentId?: string; artifactId?: string; messageId?: string; title?: string; kind?: string; operation?: string } = {}) {
  if (!await ownedChat(userId, chatId)) throw new Error("Conversation not found.");
  const desc = artifactDescriptor(content, opts.request ?? "");
  if (!desc && !opts.artifactId) return;
  await ensureIntelligence();
  const parent = opts.parentId ? (await d1<any>("SELECT id, root_id FROM intelligence_artifacts WHERE user_id = ? AND chat_id = ? AND (id = ? OR message_id = ?) LIMIT 1", [userId,chatId,opts.parentId,opts.parentId]))[0] : undefined;
  if (opts.parentId && !parent) throw new Error("Source version not found.");
  const root = parent?.root_id ?? id;
  await d1(`INSERT INTO intelligence_artifacts (id,user_id,chat_id,message_id,artifact_id,title,kind,content,content_hash,root_id,parent_id,version,operation,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,COALESCE((SELECT MAX(version) FROM intelligence_artifacts WHERE user_id = ?2 AND root_id = ?10),0)+1,?12,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE EXISTS(SELECT 1 FROM chat_sessions WHERE id = ?3 AND user_id = ?2) ON CONFLICT(user_id,id) DO NOTHING`, [id,userId,chatId,opts.messageId ?? null,opts.artifactId ?? null,opts.title ?? desc?.title ?? "Output",opts.kind ?? desc?.kind ?? "document",content,await hash(content),root,parent?.id ?? null,opts.operation ?? "generate"]);
}

/** Read actual owned messages; incoming source fences are never authority for stored artifacts. */
export async function resolveOwnedContext(userId: string, chatId: string, text: string) {
  if (!await ownedChat(userId,chatId)) throw new Error("Conversation not found.");
  const rows = await d1<any>("SELECT m.id,m.role,m.content FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE s.id = ? AND s.user_id = ? AND m.role IN ('user','assistant') ORDER BY m.created_at ASC LIMIT 1000",[chatId,userId]);
  const history: ConvMsg[] = rows.map((r) => ({ id:r.id,role:r.role,content:r.content }));
  // Exclude a persisted current request, but never remove the preceding answer.
  if (history.at(-1)?.role === "user" && history.at(-1)?.content === text) history.pop();
  const stored = await intelligenceArtifacts(userId,chatId);
  const inferred = conversationArtifacts(history).filter((r) => !stored.some((x) => x.messageId === r.messageId || x.content === r.content));
  const pool = [...stored,...inferred];
  const selected = isContentAction(text) ? selectArtifact(text,pool) : { kind:"none" as const };
  const ref = selected.kind === "none" ? resolveReference(text,history) : selected;
  const source = ref.kind === "found" ? pool.find((r) => r.messageId === ref.id || r.id === ref.id || r.content === ref.content) : undefined;
  if (source && !stored.some((r) => r.id === source.id)) {
    // Preserve legacy sources lazily only on explicit use, not destructive backfill.
    await recordIntelligenceArtifact(userId,chatId,source.id,source.content,{ request:source.title,messageId:source.messageId,title:source.title,kind:source.kind });
  }
  return { ref, sourceId:source?.id, history };
}

export async function prepareIntelligenceJob(userId: string, chatId: string | null, prompt: string) {
  const request = extractSource(prompt)?.request ?? prompt;
  if (!chatId) return { prompt, sourceId:undefined };
  const { ref, sourceId } = await resolveOwnedContext(userId,chatId,request);
  if (ref.kind === "ambiguous") throw new Error(ref.question);
  if (ref.kind === "missing") throw new Error(ref.reason);
  if (ref.kind === "found" && ref.content.length > 60000) throw new Error("The original output is too large for a lossless export in this workflow.");
  return { prompt:request + (ref.kind === "found" ? `\n\n${sourceBlock(ref)}` : ""), sourceId };
}

export async function handleTaskContinuity(userId: string, chatId: string | undefined, text: string): Promise<string | null> {
  const action = taskCommand(text);
  if (!action || !chatId) return null;
  if (!await ownedChat(userId,chatId)) throw new Error("Conversation not found.");
  const { listJobs, requestCancel, getJobInput } = await import("@/lib/jobs/jobs.server");
  const jobs = await listJobs(userId,100,chatId);
  const rows = await d1<any>("SELECT id,input,resumed_by FROM jobs WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT 100",[userId,chatId]);
  const picked = selectTask(text,jobs.map((j) => { const row=rows.find((r) => r.id===j.id); let input:any={}; try { input=JSON.parse(row?.input ?? "{}"); } catch {} return { id:j.id,status:j.status,prompt:input.prompt ?? input.params?.prompt ?? j.detail,resumedBy:row?.resumed_by }; }),action);
  if (picked === "ambiguous") return "Which task do you mean? Please name its subject.";
  if (!picked) return action === "pause" ? "There is no active background task to pause in this chat." : "There is no interrupted background task to resume in this chat.";
  if (action === "pause") return await requestCancel(userId,picked.id) ? "Pause requested. The task stops at its next checkpoint; completed steps remain saved." : "The task has already ended.";
  const prev = await getJobInput(userId,picked.id);
  if (!prev || prev.attempt >= 5) return "This task cannot be retried again.";
  const { startJob } = await import("@/lib/jobs/dispatch.server");
  const result = await startJob(userId,crypto.randomUUID(),prev.type,prev.type === "agent_task" ? { ...prev.input,resumeFrom:picked.id } : prev.input,prev.attempt+1,chatId);
  if (!result) throw new Error("The task could not be resumed.");
  return prev.type === "agent_task" ? "Task resumed from its verified checkpoint. Its progress appears in this chat." : "Task restarted using its saved inputs. Its progress appears in this chat.";
}