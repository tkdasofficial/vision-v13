// Background completion for chat replies: the work keeps running after the browser leaves or reloads,
// and the finished answer is written to the user's chat so it is there when they come back.

type Lifetime = (promise: Promise<unknown>) => void;
const WORKER_MODULE = "cloudflare:workers";
/** Resolve the request-scoped runtime BEFORE starting work or returning a response. */
export async function prepareKeepAlive(
  load: () => Promise<{ waitUntil?: Lifetime }> = () => import(/* @vite-ignore */ WORKER_MODULE),
): Promise<Lifetime> {
  try {
    const runtime = await load();
    if (typeof runtime.waitUntil !== "function") throw new Error("Background task lifetime is unavailable.");
    const waitUntil = runtime.waitUntil;
    return (promise) => waitUntil(promise);
  } catch (error) {
    const { getD1Binding, getAiBinding } = await import("@/lib/ai/runtime-env.server");
    // Fail before accepting work on a misconfigured Worker; local development has
    // no request lifetime limit and may keep draining the existing remote service.
    if (getD1Binding() || getAiBinding()) throw error;
    return () => {};
  }
}

/**
 * Saves under the browser's reply id. Only an owned empty placeholder may be
 * replaced on conflict; an existing nonempty reply is never overwritten.
 */
export async function saveReply(userId: string, chatId: string | undefined, replyId: string, content: string, meta: Record<string, unknown> = {}) {
  if (!chatId || !content.trim() || !/^[\w-]{8,64}$/.test(replyId)) return;
  try {
    const { d1 } = await import("@/lib/cloud/d1.server");
    await d1(
      "INSERT INTO chat_messages (id, session_id, role, content, metadata, created_at) SELECT ?, id, 'assistant', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM chat_sessions WHERE id = ? AND user_id = ? ON CONFLICT(id) DO UPDATE SET content = excluded.content, metadata = excluded.metadata WHERE chat_messages.session_id = excluded.session_id AND chat_messages.role = 'assistant' AND TRIM(chat_messages.content) = ''",
      [replyId, content, JSON.stringify({ ...meta, background: true }), chatId, userId],
    );
    await d1("UPDATE chat_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?", [chatId, userId]);
  } catch (e) {
    console.error("[chat:background] save failed", (e as Error)?.message);
    throw new Error("The reply could not be saved. Please reopen the chat to check its task status.");
  }
}
