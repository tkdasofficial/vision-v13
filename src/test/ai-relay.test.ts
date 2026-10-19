import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { endpoint, streamFromProvider } from "@/lib/ai/providers.server";
import { captureWorkerEnv, getSecret } from "@/lib/ai/runtime-env.server";
import { TEXT_CHAIN } from "@/lib/ai/models.server";
import { limiter } from "@/lib/ai/rate-limiter";
import { transcribe, vision } from "@/lib/tools/ai.server";
import { handleAi } from "../../auth-gateway/src/ai";

const ORIGINS = "https://app.example.com,http://localhost:8080";

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", "");
  vi.stubEnv("AUTH_GATEWAY_URL", "");
  vi.stubEnv("AUTH_ORIGIN", "");
  captureWorkerEnv({});
  limiter.reset();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); captureWorkerEnv({}); });

describe("AI relay routing", () => {
  it("Worker credentials override stale process settings", () => {
    vi.stubEnv("NVIDIA_API_KEY", "stale-host-value");
    captureWorkerEnv({ NVIDIA_API_KEY: "worker-value" });
    expect(getSecret("NVIDIA_API_KEY")).toBe("worker-value");
  });
  it.each(TEXT_CHAIN)("off-Worker $provider uses API_ORIGIN even with hosting credentials", async (model) => {
    vi.stubEnv("API_ORIGIN", "https://configured.example.workers.dev/");
    vi.stubEnv("AUTH_GATEWAY_URL", "https://old.example.workers.dev");
    vi.stubEnv("AUTH_ORIGIN", "https://app.example.com");
    for (const key of ["NVIDIA_API_KEY", "GROQ_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) vi.stubEnv(key, "must-not-send");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("data: [DONE]\n\n"));
    const result = await streamFromProvider(model, [], { maxTokens: 16, deep: false }, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (result.ok) await new Response(result.body).text();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://configured.example.workers.dev/ai/${model.provider}`);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("origin")).toBe("https://app.example.com");
  });
  it("off-Worker missing origin fails before a network call", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await streamFromProvider(TEXT_CHAIN[0], [], { maxTokens: 16, deep: false }, new AbortController().signal);
    expect(result).toEqual({ ok: false, status: 503, reason: "not configured" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("relay rejection never falls back to a direct provider", async () => {
    vi.stubEnv("API_ORIGIN", "https://configured.example.workers.dev");
    vi.stubEnv("AUTH_ORIGIN", "https://app.example.com");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const result = await streamFromProvider(TEXT_CHAIN[0], [], { maxTokens: 16, deep: false }, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://configured.example.workers.dev/ai/nvidia");
  });
  it("image reading and transcription use the same configured Worker", async () => {
    vi.stubEnv("API_ORIGIN", "https://configured.example.workers.dev");
    vi.stubEnv("AUTH_ORIGIN", "https://app.example.com");
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ result: { response: "image text" } }))
      .mockResolvedValueOnce(Response.json({ result: { text: "audio text" } }));
    expect(await vision(new Uint8Array([1]), "image/png", "Read")).toBe("image text");
    expect((await transcribe(new Uint8Array([1]))).text).toBe("audio text");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://configured.example.workers.dev/ai/run", "https://configured.example.workers.dev/ai/run",
    ]);
  });
  it("off-Worker, AI calls target the vision Worker relay with the app origin", () => {
    process.env.AUTH_ORIGIN = "https://app.example.com";
    const e = endpoint({ provider: "groq", model: "m", label: "m" } as any);
    expect(e.url).toBe("https://vision.tusharkantidasofficial.workers.dev/ai/groq");
    expect(e.origin).toBe("https://app.example.com");
  });
  it("on the Worker, calls go straight to the provider", () => {
    process.env.AUTH_ORIGIN = "https://app.example.com";
    captureWorkerEnv({ DB: { prepare() {} } });
    expect(endpoint({ provider: "groq", model: "m", label: "m" } as any).url).toContain("api.groq.com");
  });
  it("off-Worker without AUTH_ORIGIN, never falls back to a direct provider call", () => {
    const e = endpoint({ provider: "nvidia", model: "m", label: "m" } as any);
    expect(e.url).toBe("https://vision.tusharkantidasofficial.workers.dev/ai/nvidia");
    expect(e.key).toBeUndefined();
    expect(e.origin).toBeUndefined();
  });
  it("relay refuses a request with no Origin", async () => {
    const r = await handleAi(new Request("https://x/ai/groq", { method: "POST", body: "{}" }), { ALLOWED_RETURN_ORIGINS: ORIGINS }, "groq");
    expect(r.status).toBe(401);
  });
  it("relay refuses an Origin that is not allowlisted", async () => {
    const r = await handleAi(new Request("https://x/ai/groq", { method: "POST", headers: { origin: "https://evil.example.com" }, body: "{}" }), { ALLOWED_RETURN_ORIGINS: ORIGINS }, "groq");
    expect(r.status).toBe(401);
  });
  it("relay accepts an allowlisted Origin and rejects an invalid body", async () => {
    const r = await handleAi(new Request("https://x/ai/groq", { method: "POST", headers: { origin: "https://app.example.com" }, body: "{}" }), { ALLOWED_RETURN_ORIGINS: ORIGINS, GROQ_API_KEY: "k" }, "groq");
    expect(r.status).toBe(400);
  });
  it("relay accepts the localhost origin during development", async () => {
    const r = await handleAi(new Request("https://x/ai/groq", { method: "POST", headers: { origin: "http://localhost:8080" }, body: "{}" }), { ALLOWED_RETURN_ORIGINS: ORIGINS, GROQ_API_KEY: "k" }, "groq");
    expect(r.status).toBe(400);
  });
});
