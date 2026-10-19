import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { captureWorkerEnv } from "./lib/ai/runtime-env.server";
import authGateway from "../auth-gateway/src/index";

// The single Cloudflare Worker "vision" is the whole backend: it serves the app
// (SSR, server functions, /api/*) AND the auth-gateway endpoints (OAuth start/callback,
// /mail, /ai/* relay, /runtime/*, /health, JWKS). Gateway paths are dispatched here
// before the app handler. Exception: /auth/:provider/callback carrying an `assertion`
// param is the app's own OAuth finish step (the gateway redirects back with it), so
// those requests fall through to the app.
const GATEWAY_PATH = /^\/(mail|health|ai\/(nvidia|groq|cf|run)|runtime\/|\.well-known\/jwks\.json|auth\/(google|github)\/(start|callback))$/;

function isGatewayRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (!GATEWAY_PATH.test(url.pathname)) return false;
  if (url.pathname.endsWith("/callback") && url.searchParams.has("assertion")) return false;
  return true;
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // The nitro Cloudflare preset invokes this entry as fetch(request) and stashes
      // the Worker env on globalThis.__env__ — use it when env isn't passed through.
      const effectiveEnv = env ?? (globalThis as any).__env__;
      captureWorkerEnv(effectiveEnv);
      if (isGatewayRequest(request)) {
        return await authGateway.fetch(request, effectiveEnv as any);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
