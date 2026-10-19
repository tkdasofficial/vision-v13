// Single, non-streaming text completion for background story runs on the Workers Free plan.
// Free-plan invocations get ~10 ms of CPU; parsing a long SSE stream chunk by chunk blows that
// budget, while one native JSON.parse of the finished reply costs well under a millisecond.
// Waiting on the network does not count as CPU. Providers are tried in TEXT_CHAIN order
// (NVIDIA → Groq → Cloudflare Workers AI); off-Worker (no bindings) callers keep the streaming relay.
import type { Completion } from "./orchestrator.server";
import type { ModelRef } from "./models.server";
import { TEXT_CHAIN } from "./models.server";
import { getAiBinding, getD1Binding } from "./runtime-env.server";
import { endpoint, failureCategory } from "./providers.server";

/** Per-provider wall-clock cap; waiting is free on the Free plan, but a hung provider must fail over. */
export const COMPLETE_TIMEOUT_MS = 150_000;

/** Pulls the reply text out of an OpenAI-compatible or Workers AI response body. */
export function replyText(body: any): { text: string; finish: string | null } {
  const c = body?.choices?.[0];
  const text = c?.message?.content ?? c?.text ?? body?.response ?? body?.result?.response ?? "";
  return { text: typeof text === "string" ? text : "", finish: c?.finish_reason ?? null };
}

async function once(t: ModelRef, messages: unknown[], maxTokens: number): Promise<Completion> {
  const t0 = Date.now();
  const log = (status: number) => console.log(JSON.stringify({ tag: "[ai:once]", provider: t.provider, model: t.model, status, ms: Date.now() - t0 }));
  try {
    if (t.provider === "cf" && getAiBinding()) {
      const out = await Promise.race([
        getAiBinding()!.run(t.model, { messages, max_tokens: maxTokens }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), COMPLETE_TIMEOUT_MS)),
      ]);
      const { text, finish } = replyText(out);
      log(text ? 200 : 502);
      return text ? { ok: true, text, finishReason: finish, model: t } : { ok: false, status: 502, reason: "empty reply" };
    }
    const { url, key } = endpoint(t);
    if (!key) return { ok: false, status: 503, reason: "not configured" };
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: t.model, messages, stream: false, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });
    log(res.status);
    if (!res.ok) {
      const reason = (await res.text().catch(() => "")).slice(0, 300);
      console.log(JSON.stringify({ tag: "[ai:once:fail]", provider: t.provider, status: res.status, category: failureCategory(res.status, reason) }));
      return { ok: false, status: res.status, reason };
    }
    const { text, finish } = replyText(await res.json());
    return text ? { ok: true, text, finishReason: finish, model: t } : { ok: false, status: 502, reason: "empty reply" };
  } catch (e: any) {
    log(504);
    return { ok: false, status: 504, reason: String(e?.message ?? e).slice(0, 200) };
  }
}

/** True on the deployed Worker, where provider keys and bindings are available directly. */
export const onWorker = () => !!(getAiBinding() || getD1Binding());

export async function completeOnce(messages: unknown[], maxTokens: number, chain: ModelRef[] = TEXT_CHAIN): Promise<Completion> {
  let last: Completion = { ok: false, status: 503, reason: "no providers" };
  for (const t of chain) {
    last = await once(t, messages, maxTokens);
    if (last.ok && last.text.trim()) return last;
  }
  return last;
}
