// Provider-specific request details (endpoint, key, options). Server-only; keys never leave here.
// Priority is NVIDIA → Groq → Cloudflare Workers AI (see TEXT_CHAIN). Keys come from process.env or the
// Cloudflare Worker env bindings (NVIDIA_API_KEY, GROQ_API_KEY), read by getSecret.
import type { ModelRef } from "./models.server";
import { getSecret, getAiBinding, getD1Binding, aiRelayConfig } from "./runtime-env.server";
import type { ProviderEvent } from "./orchestrator.server";

export function endpoint(t: ModelRef): { url: string; key?: string; origin?: string } {
  // Off the Cloudflare Worker (no bindings), every AI call goes through the Cloudflare
  // "vision" Worker's /ai relay, which holds the provider keys. There is no direct fallback.
  // The relay authorizes callers by their Origin header against its ALLOWED_RETURN_ORIGINS
  // allowlist, so the app sends its public origin (AUTH_ORIGIN).
  if (!getAiBinding() && !getD1Binding()) {
    const { url: gw, origin } = aiRelayConfig();
    if (!origin) console.error(JSON.stringify({ tag: "[ai:relay]", error: "AUTH_ORIGIN is not set; AI calls cannot reach the Cloudflare Worker" }));
    return { url: `${gw}/ai/${t.provider}`, origin };
  }
  if (t.provider === "groq") return { url: "https://api.groq.com/openai/v1/chat/completions", key: getSecret("GROQ_API_KEY") };
  if (t.provider === "nvidia") return { url: "https://integrate.api.nvidia.com/v1/chat/completions", key: getSecret("NVIDIA_API_KEY") };
  const account = getSecret("CLOUDFLARE_ACCOUNT_ID");
  return { url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, key: account ? getSecret("CLOUDFLARE_API_TOKEN") : undefined };
}

/** Safe category for diagnostics; never includes the provider body. */
export function failureCategory(status: number, reason: string): string {
  if (/not configured/.test(reason)) return "missing_binding";
  if (status === 401 || status === 403) return "auth";
  if (status === 429 && /quota|credit|exhaust|daily|neurons|insufficient/i.test(reason)) return "quota";
  if (status === 429) return "rate_limit";
  if (status === 499) return "cancelled";
  if (status === 504 || status === 408) return "timeout";
  if (status === 404 && /model/i.test(reason)) return "invalid_model";
  if (status === 400 || status === 404 || status === 422) return "invalid_request";
  if (status >= 500) return "outage";
  return "unknown";
}

export type ProviderResult = { ok: true; body: ReadableStream<Uint8Array> } | { ok: false; status: number; reason: string };

import { AI_LIMITS } from "./limits";
const CONNECT_TIMEOUT_MS = AI_LIMITS.connectMs;

/**
 * Every model call (chat, Deep Thinking stages, Research, jobs/tools) goes through here, so the shared
 * retry policy applies everywhere. Only transient 5xx/timeouts and a real provider 429 are retried; local
 * cool-downs, missing config, permission and invalid-request errors fall through to the next model at once.
 * Retries happen before any byte is streamed, so they never duplicate output.
 */
export async function streamFromProvider(t: ModelRef, messages: unknown[], opts: { maxTokens: number; deep: boolean; deadlineAt?: number; onEvent?: (event: ProviderEvent) => void | Promise<void> }, signal: AbortSignal): Promise<ProviderResult> {
  const { withRetry, classifyFailure } = await import("./failures");
  const { result } = await withRetry((attempt) => attemptProvider(t, messages, opts, signal, attempt), {
    classify: (r) => (r.ok ? null : /not configured|cooling down|queue full/.test(r.reason) || failureCategory(r.status, r.reason) === "quota" ? "permanent" : classifyFailure(r.status, r.reason)),
    signal,
    deadlineAt: opts.deadlineAt,
    onRetry: (i) => { console.log(JSON.stringify({ tag: "[ai:retry]", provider: t.provider, model: t.model, ...i })); },
  });
  return result;
}

async function attemptProvider(t: ModelRef, messages: unknown[], opts: { maxTokens: number; deep: boolean; deadlineAt?: number; onEvent?: (event: ProviderEvent) => void | Promise<void> }, signal: AbortSignal, _attempt: number): Promise<ProviderResult> {
  if (signal.aborted) return { ok: false, status: 499, reason: "cancelled" };
  if (opts.deadlineAt && Date.now() >= opts.deadlineAt) return { ok: false, status: 504, reason: "request deadline reached" };
  if (_attempt > 0) await opts.onEvent?.({ stage: "retrying", provider: t.provider, model: t.label });
  // On the Cloudflare Worker, the AI binding (env.AI) is the primary path — it needs no
  // API token and does not consume the REST API quota. REST is Worker-only; off-Worker calls use the relay.
  if (t.provider === "cf") {
    const bound = await attemptWorkersAiBinding(t, messages, opts, signal);
    if (bound) return bound;
  }
  const { url, key, origin } = endpoint(t);
  if (!key && !origin) return { ok: false, status: 503, reason: "not configured" };
  const { limiter } = await import("./rate-limiter");
  if (!limiter.available(t.provider)) return { ok: false, status: 429, reason: "provider cooling down" };
  let release: () => void;
  try { release = await limiter.acquire(t.provider, undefined, signal); } catch { return { ok: false, status: signal.aborted ? 499 : 429, reason: "rate limit queue full" }; }
  const t0 = Date.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(CONNECT_TIMEOUT_MS, (opts.deadlineAt ?? Infinity) - Date.now())));
  const log = (status: number) => console.log(JSON.stringify({ tag: "[ai:call]", provider: t.provider, model: t.model, status, kind: status >= 200 && status < 300 ? "ok" : status === 499 ? "cancelled" : status === 504 ? "timeout" : "error", ms: Date.now() - t0, ...limiter.snapshot(t.provider) }));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: t.model,
        messages,
        stream: true,
        max_tokens: opts.maxTokens,
        ...(opts.deep && t.provider === "groq" ? { reasoning_effort: "high" } : {}),
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    limiter.report(t.provider, res.status, res.headers.get("retry-after"));
    log(res.status);
    if (res.ok && res.body) {
      // Release on every termination path, not just flush (which never runs after a stream error).
      const reader = res.body.getReader();
      let ended = false;
      let streamTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { if (ended) return; ended = true; release(); signal.removeEventListener("abort", abortStream); clearTimeout(streamTimer); };
      let terminalError: Error | undefined;
      const abortStream = () => { terminalError = new Error(signal.aborted ? "Request cancelled." : "Provider stream deadline reached."); ctrl.abort(); void reader.cancel().catch(() => {}); cleanup(); };
      streamTimer = opts.deadlineAt ? setTimeout(abortStream, Math.max(1, opts.deadlineAt - Date.now())) : undefined;
      signal.addEventListener("abort", abortStream, { once: true });
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try { const chunk = await reader.read(); if (terminalError) { cleanup(); controller.error(terminalError); } else if (chunk.done) { cleanup(); controller.close(); } else controller.enqueue(chunk.value); }
          catch (error) { cleanup(); controller.error(error); }
        },
        async cancel(reason) { cleanup(); await reader.cancel(reason); },
      });
      return { ok: true, body };
    }
    release();
    const reason = (await res.text().catch(() => "")).slice(0, 300);
    console.log(JSON.stringify({ tag: "[ai:fail]", provider: t.provider, model: t.model, status: res.status, category: failureCategory(res.status, reason), ms: Date.now() - t0 }));
    return { ok: false, status: res.status, reason };
  } catch (e: any) {
    clearTimeout(timer);
    release();
    const status = signal.aborted ? 499 : 504;
    if (status === 504) limiter.report(t.provider, 504);
    log(status);
    return { ok: false, status, reason: e?.message ?? "network error" };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Cloudflare provider via the Workers AI binding (env.AI.run). Returns null when no
 * binding exists, so endpoint() selects the relay off Worker or REST on Worker.
 * With stream:true the binding returns an OpenAI-compatible SSE ReadableStream.
 */
async function attemptWorkersAiBinding(t: ModelRef, messages: unknown[], opts: { maxTokens: number; deadlineAt?: number }, signal: AbortSignal): Promise<ProviderResult | null> {
  const { getAiBinding } = await import("./runtime-env.server");
  const ai = getAiBinding();
  if (!ai) return null;
  if (signal.aborted) return { ok: false, status: 499, reason: "cancelled" };
  if (opts.deadlineAt && Date.now() >= opts.deadlineAt) return { ok: false, status: 504, reason: "request deadline reached" };
  const { limiter } = await import("./rate-limiter");
  if (!limiter.available(t.provider)) return { ok: false, status: 429, reason: "provider cooling down" };
  let release: () => void;
  try { release = await limiter.acquire(t.provider, undefined, signal); } catch { return { ok: false, status: signal.aborted ? 499 : 429, reason: "rate limit queue full" }; }
  const t0 = Date.now();
  try {
    const stream = await ai.run(t.model, { messages, max_tokens: opts.maxTokens, stream: true });
    if (!stream || typeof (stream as any).getReader !== "function") {
      release();
      console.log(JSON.stringify({ tag: "[ai:fail]", provider: t.provider, model: t.model, status: 502, category: "outage", ms: Date.now() - t0, via: "binding" }));
      return { ok: false, status: 502, reason: "workers ai binding returned no stream" };
    }
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    let ended = false;
    const cleanup = () => { if (ended) return; ended = true; release(); signal.removeEventListener("abort", abortStream); };
    const abortStream = () => { void reader.cancel().catch(() => {}); cleanup(); };
    signal.addEventListener("abort", abortStream, { once: true });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const chunk = await reader.read(); if (chunk.done) { cleanup(); controller.close(); } else controller.enqueue(chunk.value); }
        catch (error) { cleanup(); controller.error(error); }
      },
      async cancel(reason) { cleanup(); await reader.cancel(reason); },
    });
    console.log(JSON.stringify({ tag: "[ai:call]", provider: t.provider, model: t.model, status: 200, kind: "ok", ms: Date.now() - t0, via: "binding" }));
    return { ok: true, body };
  } catch (e: any) {
    release();
    const status = signal.aborted ? 499 : 502;
    console.log(JSON.stringify({ tag: "[ai:fail]", provider: t.provider, model: t.model, status, category: status === 499 ? "cancelled" : "outage", ms: Date.now() - t0, via: "binding" }));
    return { ok: false, status, reason: String(e?.message ?? "workers ai error").slice(0, 300) };
  }
}
