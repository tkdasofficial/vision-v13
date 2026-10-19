// Reads server settings from wherever the runtime provides them: process.env (Lovable hosting / dev,
// or Workers with nodejs_compat) or the Cloudflare Worker env bindings (secrets set in Workers & Pages →
// Settings → Variables and Secrets). Values never leave the server and are never logged.

import { AUTH_GATEWAY_URL } from "@/lib/cloud/auth-gateway";

type Bindings = Record<string, unknown>;
const KEY = "__visionWorkerEnv";

/** Called once per request by src/server.ts with the Worker env object. */
export function captureWorkerEnv(env: unknown) {
  if (env && typeof env === "object") (globalThis as any)[KEY] = env;
}

function workerEnv(): Bindings | undefined {
  // __visionWorkerEnv is set by src/server.ts (dev entry); __env__ is set by the
  // nitro Cloudflare preset on every request in the deployed Worker bundle.
  return ((globalThis as any)[KEY] ?? (globalThis as any).__env__) as Bindings | undefined;
}

export function getSecret(name: string): string | undefined {
  // Live Worker bindings take precedence over hosting/build-time values.
  const v = workerEnv()?.[name];
  if (typeof v === "string" && v) return v;
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (fromProcess) return fromProcess;
  return undefined;
}

/** The D1 database binding (env.DB), when the Worker has one. */
export function getD1Binding(): { prepare: (sql: string) => any } | undefined {
  const db = workerEnv()?.["DB"] as any;
  return db && typeof db.prepare === "function" ? db : undefined;
}

/** The Cloudflare Queue producer for story generation (env.STORY_QUEUE), when bound. */
export function getStoryQueue(): { send: (body: unknown, opts?: unknown) => Promise<void> } | undefined {
  const q = workerEnv()?.["STORY_QUEUE"] as any;
  return q && typeof q.send === "function" ? q : undefined;
}

/** The Workers AI binding (env.AI), when the Worker has one. */
export function getAiBinding(): { run: (model: string, input: unknown, opts?: unknown) => Promise<any> } | undefined {
  const ai = workerEnv()?.["AI"] as any;
  return ai && typeof ai.run === "function" ? ai : undefined;
}

/** Safe presence report: names and true/false only, never values. */
export function providerConfigReport() {
  return {
    NVIDIA_API_KEY: !!getSecret("NVIDIA_API_KEY"),
    GROQ_API_KEY: !!getSecret("GROQ_API_KEY"),
    workersAiBinding: !!getAiBinding(),
    workersAiRest: !!(getSecret("CLOUDFLARE_ACCOUNT_ID") && getSecret("CLOUDFLARE_API_TOKEN")),
  };
}

/** Off-Worker inference uses the same Cloudflare backend as /api/*. */
export function aiRelayConfig(): { url: string; origin?: string } {
  const url = (getSecret("API_ORIGIN") || getSecret("AUTH_GATEWAY_URL") || AUTH_GATEWAY_URL).replace(/\/+$/, "");
  const origin = (getSecret("AUTH_ORIGIN") || "").replace(/\/+$/, "") || undefined;
  return { url, origin };
}
