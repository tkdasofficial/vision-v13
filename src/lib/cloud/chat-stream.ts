import type { ChatMode, OutputKind } from "@/lib/ai/modes";
import { parseTaskEvent, type TaskEvent } from "@/lib/ai/task-events";

export type ChatMeta = { executionMode: ChatMode; output: OutputKind; model?: string };

// Streams an AI reply from the server's /api/chat endpoint.
export async function streamChat(
  messages: { role: string; content: any }[],
  onText: (full: string) => void,
  toolId?: string,
  opts: { mode?: ChatMode; onMeta?: (m: ChatMeta) => void; onStatus?: (stage: string, detail?: string) => void; onTask?: (e: TaskEvent) => void; signal?: AbortSignal; webSearch?: boolean; requestId?: string; conversationId?: string } = {},
): Promise<string> {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, toolId, mode: opts.mode ?? "default", requestId: opts.requestId, conversationId: opts.conversationId, ...(opts.webSearch ? { webSearch: true } : {}) }),
    signal: opts.signal,
  });
  if (!resp.ok || !resp.body) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || "AI couldn't answer right now.");
  }
  opts.onMeta?.({
    executionMode: (resp.headers.get("X-Vision-Execution") as ChatMode) || "default",
    output: (resp.headers.get("X-Vision-Output") as OutputKind) || "chat",
    model: resp.headers.get("X-Vision-Model") || undefined,
  });
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); } catch (e) { if (opts.signal?.aborted) break; throw e; }
    const { done, value } = chunk;
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") continue;
      let p: any;
      try { p = JSON.parse(json); } catch { continue; }
      if (p.vision_error) throw new Error(p.vision_error.message || "The request failed.");
      {
        if (p.vision_task) { const ev = parseTaskEvent(p.vision_task); if (ev) opts.onTask?.(ev); continue; }
        if (p.vision_status) { opts.onStatus?.(String(p.vision_status.stage), p.vision_status.detail ? String(p.vision_status.detail) : undefined); continue; }
        const delta = p.choices?.[0]?.delta?.content ?? p.response;
        if (delta) { text += delta; onText(text); }
      }
    }
  }
  // Some models wrap private reasoning in <think> tags; never show it.
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Server record of the latest reply generation in a chat (null when none was recorded). */
export async function fetchGeneration(chatId: string): Promise<import("@/lib/ai/generation-state").GenerationView | null> {
  const res = await fetch(`/api/chat-status?chat=${encodeURIComponent(chatId)}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return ((await res.json()) as any).generation ?? null;
}
