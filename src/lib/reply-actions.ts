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