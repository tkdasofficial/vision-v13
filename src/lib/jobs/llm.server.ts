// Collects a full text answer from the coding model chain (same providers as chat).
import { TEXT_CHAIN, type ModelRef } from "@/lib/ai/models.server";
import { orchestrateText, type ProviderEvent } from "@/lib/ai/orchestrator.server";

const CODING: ModelRef[] = TEXT_CHAIN;
/** Planning/JSON work: general reasoning models first. */
export const PLANNING: ModelRef[] = TEXT_CHAIN;

export async function complete(system: string, user: string, opts: { maxTokens?: number; signal?: AbortSignal; models?: ModelRef[]; taskId?: string; onEvent?: (event: ProviderEvent) => void | Promise<void> } = {}): Promise<{ text: string; model: string }> {
  const signal = opts.signal ?? new AbortController().signal;
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  const r = await orchestrateText(messages, { maxTokens: opts.maxTokens ?? 8192, deep: false, signal, models: opts.models ?? CODING, taskId: opts.taskId, onEvent: opts.onEvent });
  if (!r.ok) throw new Error(r.reason);
  return { text: r.text, model: r.model.label };
}

async function readSse(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try { const j = JSON.parse(data); out += j.choices?.[0]?.delta?.content ?? j.response ?? ""; } catch { /* partial */ }
    }
  }
  return out;
}
