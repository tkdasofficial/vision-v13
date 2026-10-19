// Off-Worker API proxy: when the frontend is hosted anywhere other than the Cloudflare
// Worker (e.g. Lovable hosting), API calls must still execute on the Worker — that is
// where the D1 binding, Workers AI binding and provider secrets live. With API_ORIGIN set
// (the Worker's public URL, e.g. https://vision-app.<account>.workers.dev), every /api/*
// handler forwards the request there and streams the response back. On the Worker itself
// (DB/AI binding present), requests stay local; other hosts use the shared backend by default.

import { getD1Binding, getAiBinding, getSecret } from "@/lib/ai/runtime-env.server";
import { DEVELOPMENT_API_ORIGIN } from "@/lib/backend-config";

/** The Cloudflare Worker's public origin, when configured. */
export function getApiOrigin(development = import.meta.env.DEV): string | undefined {
  // Fall back to the shared public backend whenever API_ORIGIN is unset — the Lovable
  // preview is a production-mode build (DEV=false) but still has no API_ORIGIN secret.
  const raw = getSecret("API_ORIGIN") || DEVELOPMENT_API_ORIGIN;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return undefined;
  }
}

/** True when this process is the Cloudflare Worker (bindings present). */
export function isWorkerRuntime(): boolean {
  return !!(getD1Binding() || getAiBinding());
}

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade"]);

/**
 * Returns a proxied Response when the request must run on the Cloudflare Worker,
 * or null when it should be handled locally. The local same-origin check runs
 * before forwarding; the forwarded request carries the session cookie and an
 * Origin matching the Worker so its own same-origin check passes.
 */
export async function maybeProxyToWorker(request: Request): Promise<Response | null> {
  if (isWorkerRuntime()) return null;
  const apiOrigin = getApiOrigin();
  // Hard rule: API calls execute on the Cloudflare Worker only. Off-Worker hosting
  // without API_ORIGIN is a misconfiguration — fail clearly, never run locally.
  if (!apiOrigin) {
    console.error("[api-proxy] API_ORIGIN is not set; API calls must run on the Cloudflare Worker");
    return Response.json(
      { error: "The backend service is not configured on this host. Please try again shortly." },
      { status: 503 },
    );
  }

  const { factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
  try {
    assertSameOrigin(factsFrom(request.headers, null));
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 403 });
  }

  const incoming = new URL(request.url);
  const target = `${apiOrigin}${incoming.pathname}${incoming.search}`;
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (key === "origin" || key === "referer") continue;
    headers.set(name, value);
  }
  headers.set("origin", apiOrigin);
  headers.set("referer", `${apiOrigin}/`);
  headers.set("x-forwarded-host", incoming.host);
  // fetch may decode upstream bytes while retaining the compression header.
  // Plain bytes avoid a second decompression by the browser for JSON/SSE/downloads.
  headers.set("accept-encoding", "identity");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Required by undici/Node when streaming a request body.
      ...(hasBody ? { duplex: "half" } : {}),
      redirect: "manual",
    } as RequestInit);
    const responseHeaders = new Headers();
    for (const [name, value] of upstream.headers) {
      const key = name.toLowerCase();
      if (HOP_BY_HOP.has(key) || key === "set-cookie" || key === "content-encoding") continue;
      responseHeaders.set(name, value);
    }
    // Session cookies from the Worker must be re-scoped to this origin.
    const setCookies = upstream.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) responseHeaders.append("set-cookie", cookie);
    const isStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    const { prepareKeepAlive } = await import("@/lib/jobs/chat-background.server");
    const keepAlive = isStream ? await prepareKeepAlive() : undefined;
    return new Response(isStream && upstream.body ? detachFromClient(upstream.body, keepAlive) : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch (e: any) {
    console.error("[api-proxy] worker unreachable", e?.message);
    return Response.json({ error: "The backend service is unreachable. Please try again shortly." }, { status: 502 });
  }
}

/**
 * Streams the Worker's answer to the browser, but keeps reading it to the end even if the browser
 * disconnects (reload, closed tab). The Worker therefore never sees a disconnect, finishes the
 * generation and saves it; the reloaded page reconnects through /api/chat-status.
 */
export function detachFromClient(body: ReadableStream<Uint8Array>, keepAlive?: (promise: Promise<unknown>) => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let clientGone = false;
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      const drain = (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!clientGone) { try { ctrl.enqueue(value); } catch { clientGone = true; } }
          }
          if (!clientGone) ctrl.close();
        } catch (e) {
          if (!clientGone) { try { ctrl.error(e); } catch { /* closed */ } }
        }
      })();
      keepAlive?.(drain);
    },
    cancel() { clientGone = true; /* keep draining upstream */ },
  });
}
