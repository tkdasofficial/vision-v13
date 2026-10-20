// One owner-scoped dispatcher shared by every chat mode. Explicit commands never need a provider.
import { detectMemoryCommand, matchForget, relevantMemories, permanentMemoryBlock, detectAutoMemory, includesPersonal, memorySubject } from "./memory";
import type { MemoryScope, PermanentMemory } from "./memory";
import { memoryPrivacy, normalizeMemory, userMemoryTarget, type MemoryTurn } from "./memory-policy";
import { savePermanentMemory, deletePermanentMemories, tryLoadPermanentMemories, setMemoryEnabled, loadChatContext, memoryRevision } from "./memory.server";
import { parsePrefs } from "../settings";

export type MemoryHandling = { reply: string | null; block: string; auto: (() => Promise<unknown>) | null };
export async function handleChatMemory(input: { userId: string; chatId?: string; owned: boolean; scope: MemoryScope; text: string; history: MemoryTurn[]; emit?: (stage: "remembering" | "saving_memory" | "updating_memory" | "deleting_memory") => void }): Promise<MemoryHandling> {
  const empty: MemoryHandling = { reply: null, block: "", auto: null };
  let cmd = detectMemoryCommand(input.text);
  // Unsaved/private chats and project-only scope cannot mutate or read personal memories.
  if (!input.owned || !includesPersonal(input.scope)) return cmd.action === "none" ? empty : { ...empty, reply: "Personal memory isn't available in this chat. Use a saved personal chat or Settings → Memory." };
  if (cmd.action === "enable" || cmd.action === "disable") {
    const enabled = cmd.action === "enable";
    const ok = await setMemoryEnabled(input.userId, enabled);
    return { ...empty, reply: ok ? enabled ? "Memory is back on." : "Memory is off. Your saved memories are preserved." : "I couldn't change memory right now. Please try again." };
  }
  const context = await loadChatContext(input.userId, input.chatId);
  if (!context.owned) return { ...empty, reply: cmd.action === "none" ? null : "I couldn't check this chat's saved memory access. Please try again." };
  const prefs = parsePrefs(context.prefsRaw);
  const deleting = cmd.action === "forget" || cmd.action === "forget_all" || cmd.action === "forget_context";
  if (!prefs.savedMemories && !deleting) return { ...empty, reply: cmd.action === "none" ? null : "Memory is off. Say “Turn memory back on” to enable it.", block: "Saved memory is off. Do not claim to save or recall permanent memories." };
  if (cmd.action === "update_context") return { ...empty, reply: "Which saved fact changed, and what should replace it?" };
  if (cmd.action === "save_context" || cmd.action === "forget_context") {
    const target = userMemoryTarget(input.history);
    if (target.kind !== "found") return { ...empty, reply: "Which detail do you want me to remember or forget? Please state the fact." };
    cmd = cmd.action === "save_context" ? { action: "save", content: target.content } : { action: "forget", query: target.content };
  }
  if (cmd.action === "save") {
    if (memoryPrivacy(cmd.content) === "secret") return { ...empty, reply: "I won't store passwords, tokens, financial identifiers, or other secrets in memory." };
    input.emit?.("saving_memory");
    const saved = await savePermanentMemory(input.userId, cmd.content, "explicit", input.chatId);
    return { ...empty, reply: !saved ? "I couldn't save that memory. Please try again." : saved.plan.kind === "replace" ? `Updated my saved memory: ${saved.memory.content}` : `I'll remember: ${saved.memory.content}` };
  }
  if (cmd.action === "forget_all") {
    input.emit?.("deleting_memory");
    const count = await deletePermanentMemories(input.userId, "all");
    return { ...empty, reply: count === null ? "I couldn't delete your memories. Please try again." : "Your saved memories have been deleted. Your chats are unchanged." };
  }
  input.emit?.("remembering");
  const revision = await memoryRevision(input.userId);
  const list = await tryLoadPermanentMemories(input.userId);
  if (cmd.action === "forget") {
    if (!list) return { ...empty, reply: "I couldn't check your saved memories. Nothing was deleted. Please try again." };
    const match = matchForget(list, cmd.query);
    if (match.kind === "ambiguous") return { ...empty, reply: `Which memory should I forget?\n\n${match.candidates.map((m) => `- ${m.content}`).join("\n")}` };
    if (match.kind === "none") return { ...empty, reply: "No saved memory matches that detail. Nothing was deleted." };
    input.emit?.("deleting_memory");
    const n = await deletePermanentMemories(input.userId, [match.memory.id]);
    return { ...empty, reply: n === null ? "I couldn't delete that memory. Please try again." : "That saved memory has been deleted. Your chats are unchanged." };
  }
  if (cmd.action === "recall") {
    if (!list) return { ...empty, reply: "I couldn't check your saved memories. Please try again." };
    const scoped = /\babout (?:me|myself)\b|^(?:show|list)|^what did i (?:ask|tell) you to remember/i.test(input.text) ? list : relevantMemories(list, input.text, 4000);
    return { ...empty, reply: scoped.length ? `Here's what I have saved:\n\n${scoped.map((m) => `- ${m.content}`).join("\n")}` : "I don't have a saved memory matching that request." };
  }
  // Suppress obsolete same-subject legacy facts without destructive backfills.
  const seen = new Set<string>();
  const current = (list ?? []).filter((m: PermanentMemory) => { const key = memorySubject(m.content) ?? normalizeMemory(m.content); if (seen.has(key)) return false; seen.add(key); return true; });
  const rel = relevantMemories(current, input.text);
  const fact = detectAutoMemory(input.text);
  return { reply: null, block: permanentMemoryBlock(rel), auto: fact && revision !== null ? () => savePermanentMemory(input.userId, fact, "auto", input.chatId, revision) : null };
}