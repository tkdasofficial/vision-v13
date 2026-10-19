// Per-conversation chat mode. Browser-safe and pure over a Storage-like object so it is unit-tested.
// A mode stays on for its chat until the user turns it off; a mode picked before the first message
// is kept as a "draft" and moved onto the new chat when it is created.
import { normalizeMode, type ChatMode } from "@/lib/ai/modes";

export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "vision_chat_mode:";
const DRAFT = `${PREFIX}__draft`;
const key = (chatId: string | null) => (chatId ? PREFIX + chatId : DRAFT);

/** Saved mode for a chat (or the new-chat draft), or null when nothing was chosen yet. */
export function loadChatMode(store: KV | null, chatId: string | null): ChatMode | null {
  try {
    const v = store?.getItem(key(chatId));
    return v ? normalizeMode(v) : null;
  } catch { return null; }
}

export function saveChatMode(store: KV | null, chatId: string | null, mode: ChatMode) {
  try { store?.setItem(key(chatId), mode); } catch { /* storage full/blocked */ }
}

/** Moves the draft mode onto a freshly created chat so it keeps the mode chosen before sending. */
export function adoptDraftMode(store: KV | null, chatId: string, fallback: ChatMode): ChatMode {
  const draft = loadChatMode(store, null) ?? fallback;
  saveChatMode(store, chatId, draft);
  try { store?.removeItem(DRAFT); } catch { /* ignore */ }
  return draft;
}

export const browserStore = (): KV | null => (typeof window === "undefined" ? null : window.localStorage);
