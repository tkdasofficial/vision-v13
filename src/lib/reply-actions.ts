import type { ChatMessage } from "@/lib/types";

export function deleteReply(messages: ChatMessage[], id: string): ChatMessage[] {
  return messages.map((m) => m.id === id ? { ...m, content: "", deleted: true } : m);
}

export function branchReplies(messages: ChatMessage[], id: string): ChatMessage[] {
  const index = messages.findIndex((m) => m.id === id && !m.deleted);
  if (index < 0) return [];
  return messages.slice(0, index + 1).filter((m) => !m.deleted).map((m) => ({
    ...m, id: crypto.randomUUID(), archivedJob: !!m.job, timestamp: new Date(m.timestamp),
  }));
}

export function replyText(message: ChatMessage): string {
  return [message.content, ...(message.job?.artifacts.map((a) => a.name) ?? [])].filter(Boolean).join("\n");
}

/** Successful generation and completed presentation are independent gates. */
export function canUseReplyActions(message: ChatMessage, fullyDisplayed = true): boolean {
  if (message.role !== "assistant" || message.deleted || message.responsePending || !fullyDisplayed || message.activity?.failed) return false;
  if (message.deep && message.deep.stage !== "done") return false;
  if (message.job && !["completed", "completed_with_warnings"].includes(message.job.status)) return false;
  return Boolean(replyText(message).trim() || message.document || message.generatedFile || message.webApp || message.zipAnalysis || message.convertFile);
}

/** Speech engines commonly stop on very long utterances; queue bounded paragraphs. */
export function speechChunks(text: string): string[] {
  const plain = text.replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[#*_~>`|]/g, "").trim();
  return plain.match(/[^\n.!?]{1,220}(?:[.!?]+|\n+|$)|[^\n.!?]{1,220}/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}