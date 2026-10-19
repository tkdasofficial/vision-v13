import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEXT_CHAIN } from "@/lib/ai/models.server";
import { failureCategory } from "@/lib/ai/providers.server";
import { captureWorkerEnv, getSecret, providerConfigReport } from "@/lib/ai/runtime-env.server";
import { PLANNING, complete } from "@/lib/jobs/llm.server";
import { ALL_PROVIDERS_UNAVAILABLE } from "@/lib/ai/orchestrator.server";
import { limiter } from "@/lib/ai/rate-limiter";

const sse = (t: string) => new Response(`data: {"choices":[{"delta":{"content":"${t}"}}]}\n\ndata: [DONE]\n\n`, { status: 200 });
const host = (u: unknown) => new URL(String(u)).host;

describe("provider priority", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((f: any, ms: number) => timer(f, ms < 4000 ? 0 : ms)) as any);
    limiter.reset();
    delete process.env.NVIDIA_API_KEY; delete process.env.GROQ_API_KEY;
    captureWorkerEnv({ NVIDIA_API_KEY: "n", GROQ_API_KEY: "g", DB: { prepare() {} } });
    process.env.CLOUDFLARE_ACCOUNT_ID = "a"; process.env.CLOUDFLARE_API_TOKEN = "c";
  });

  it("text chain is NVIDIA, then Groq, then Cloudflare", () => {
    expect(TEXT_CHAIN.map((m) => m.provider)).toEqual(["nvidia", "groq", "cf"]);
  });

  it("reads keys from Cloudflare Worker bindings and reports presence only", () => {
    expect(getSecret("NVIDIA_API_KEY")).toBe("n");
    const r = providerConfigReport();
    expect(r).toMatchObject({ NVIDIA_API_KEY: true, GROQ_API_KEY: true });
    expect(JSON.stringify(r)).not.toMatch(/"n"|"g"/);
  });

  it("NVIDIA success calls nothing else", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(sse("Hello"));
    const r = await complete("s", "u", { models: TEXT_CHAIN });
    expect(r.model).toMatch(/Nemotron/);
    expect(f.mock.calls.map((c) => host(c[0]))).toEqual(["integrate.api.nvidia.com"]);
  });

  it("NVIDIA quota → Groq; invalid key is not retried", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("bad key", { status: 401 })).mockResolvedValueOnce(sse("Hi"));
    const r = await complete("s", "u", { models: TEXT_CHAIN });
    expect(r.model).toMatch(/Groq/);
    expect(f.mock.calls.map((c) => host(c[0]))).toEqual(["integrate.api.nvidia.com", "api.groq.com"]);
  });

  it("both external fail (timeout, malformed) → Cloudflare", async () => {
    const f = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async (u) => host(u) === "api.cloudflare.com" ? sse("CF") : host(u) === "api.groq.com" ? new Response("data: nonsense\n\n", { status: 200 }) : Promise.reject(new Error("timeout")));
    const r = await complete("s", "u", { models: TEXT_CHAIN });
    expect(r.model).toMatch(/Cloudflare/);
    expect(f.mock.calls.at(-1)?.[0]).toMatch(/api\.cloudflare\.com/);
  });

  it("missing bindings skip the provider without a network call", async () => {
    captureWorkerEnv({ DB: { prepare() {} } });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(sse("CF"));
    await complete("s", "u", { models: TEXT_CHAIN });
    expect(f.mock.calls.map((c) => host(c[0]))).toEqual(["api.cloudflare.com"]);
  });

  it("all fail → truthful error with no secret", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 403 }));
    await expect(complete("s", "u", { models: TEXT_CHAIN })).rejects.toThrow(ALL_PROVIDERS_UNAVAILABLE);
  });

  it("categorises failures", () => {
    expect(failureCategory(503, "not configured")).toBe("missing_binding");
    expect(failureCategory(401, "")).toBe("auth");
    expect(failureCategory(429, "daily neurons quota")).toBe("quota");
    expect(failureCategory(429, "")).toBe("rate_limit");
    expect(failureCategory(504, "")).toBe("timeout");
    expect(failureCategory(404, "model not found")).toBe("invalid_model");
    expect(failureCategory(400, "")).toBe("invalid_request");
    expect(failureCategory(502, "")).toBe("outage");
    expect(PLANNING.length).toBe(3);
  });
});
