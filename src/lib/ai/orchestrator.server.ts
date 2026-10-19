// Sequential text orchestration. Side effects (files, checkpoints) run only after this returns.
import { TEXT_CHAIN, type ModelRef } from "./models.server";
import { streamFromProvider, failureCategory, type ProviderResult } from "./providers.server";
import { collectStream } from "./deep/sse";
import { AI_LIMITS } from "./limits";

export const ALL_PROVIDERS_UNAVAILABLE = "All AI providers are currently unavailable. Please try again shortly.";
export type ProviderEvent = { stage: "retrying" | "switching_provider"; provider: string; model: string; category?: string };
export type ProviderPolicy = "fallback" | "input" | "cancelled";
export function providerPolicy(status: number, reason: string): ProviderPolicy {
  if (status === 499) return "cancelled";
  // 413 is provider-specific (each provider has its own payload limit), so the chain
  // falls through to the next provider; it only becomes an input error if every
  // provider rejects the payload (handled in orchestrateText).
  if (status === 400 || status === 422) return "input";
  // A provider credential failure is not an app-user authorization failure (checked before calling here).
  if (status === 403 && /content.?policy|safety|refusal/i.test(reason)) return "input";
  return "fallback";
}
const STREAM_GRACE_MS = 5_000;

async function withStreamDeadline<T>(work: Promise<T>, body: unknown, deadlineAt: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { (body as ReadableStream | undefined)?.cancel?.().catch(() => undefined); } catch { /* already closed */ }
      reject(new Error("stream deadline reached"));
    }, Math.max(1, deadlineAt - Date.now()));
  });
  try { return await Promise.race([work, expired]); }
  finally { clearTimeout(timer); }
}

export type Completion = { ok: true; text: string; finishReason: string | null; model: ModelRef } | { ok: false; status: number; reason: string };

export async function orchestrateText(messages: unknown[], opts: {
  maxTokens: number; deep: boolean; signal: AbortSignal; models?: ModelRef[]; taskId?: string;
  deadlineAt?: number; onEvent?: (event: ProviderEvent) => void | Promise<void>;
  call?: (model: ModelRef, messages: unknown[], opts: { maxTokens: number; deep: boolean; deadlineAt?: number; onEvent?: (event: ProviderEvent) => void | Promise<void> }, signal: AbortSignal) => Promise<ProviderResult>;
}): Promise<Completion> {
  const deadlineAt = opts.deadlineAt ?? Date.now() + AI_LIMITS.providerChainMs;
  const models = opts.models ?? TEXT_CHAIN;
  const call = opts.call ?? streamFromProvider;
  let inputRejected: { status: number; reason: string } | null = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (opts.signal.aborted) return { ok: false, status: 499, reason: "Request cancelled." };
    if (Date.now() >= deadlineAt) break;
    if (i > 0) await opts.onEvent?.({ stage: "switching_provider", provider: model.provider, model: model.label });
    const started = Date.now();
    // Leave each remaining provider connection time within the same total budget.
    const remainingProviders = models.length - i - 1;
    const remainingMs = deadlineAt - started;
    const reserveMs = Math.min(remainingProviders * AI_LIMITS.connectMs, remainingMs * remainingProviders / (remainingProviders + 1));
    const providerDeadlineAt = deadlineAt - reserveMs;
    // Hard stop slightly after the provider's own deadline, never eating the next provider's reserve.
    const hardStopAt = providerDeadlineAt + (reserveMs > 0 ? Math.min(STREAM_GRACE_MS, reserveMs / 2) : STREAM_GRACE_MS);
    let status = 502;
    let category = "empty_or_interrupted_stream";
    // The connection phase gets the same hard stop: a transport that never answers
    // (no headers, no error) must not hold the chain past this provider's budget share.
    const result: ProviderResult = await withStreamDeadline(
      call(model, messages, { maxTokens: opts.maxTokens, deep: opts.deep, deadlineAt: providerDeadlineAt, onEvent: opts.onEvent }, opts.signal),
      undefined, hardStopAt,
    ).catch(() => ({ ok: false as const, status: 504, reason: "provider did not respond before its deadline" }));
    if (result.ok) {
      try {
        // Hard stop for a stream that stalls past this provider's share of the budget (some
        // transports, e.g. the Workers AI binding, do not abort on their own), so the chain
        // fails over instead of waiting forever.
        const output = await withStreamDeadline(collectStream(result.body), result.body, hardStopAt);
        const text = output.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        if (text) {
          console.log(JSON.stringify({ tag: "[ai:orchestration]", taskId: opts.taskId, provider: model.provider, model: model.model, attempt: i + 1, outcome: "success", ms: Date.now() - started }));
          return { ok: true, text, finishReason: output.finishReason, model };
        }
      } catch { /* No partial answer escapes; switching cannot duplicate output. */ }
    } else {
      status = result.status;
      category = failureCategory(status, result.reason);
      const policy = providerPolicy(status, result.reason);
      if (policy === "cancelled") return { ok: false, status, reason: "Request cancelled." };
      // A provider-specific payload limit (413) must not kill the chain: another provider may
      // accept the same request. Only when no provider succeeds do we surface the input error.
      if (policy === "input" && status !== 413) return { ok: false, status, reason: "The AI request is invalid or unsupported. Please check the input and required format." };
      if (status === 413) inputRejected = { status, reason: result.reason };
    }
    console.log(JSON.stringify({ tag: "[ai:orchestration]", taskId: opts.taskId, provider: model.provider, model: model.model, attempt: i + 1, outcome: "fallback", status, category, ms: Date.now() - started }));
  }
  console.log(JSON.stringify({ tag: "[ai:orchestration]", taskId: opts.taskId, outcome: "exhausted" }));
  if (inputRejected) return { ok: false, status: 413, reason: "The request is too large for the available AI providers. Please shorten it or split it into smaller parts." };
  return { ok: false, status: 503, reason: ALL_PROVIDERS_UNAVAILABLE };
}