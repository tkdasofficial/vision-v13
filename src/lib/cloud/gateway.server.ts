// Runs the auth-gateway handlers (OAuth start/callback, /mail, /ai relay, /runtime,
// /health, JWKS) inside the main "vision" Worker. The gateway code lives in
// auth-gateway/src and is environment-agnostic; here we build its env object from
// whatever the runtime provides (process.env off-Worker, Worker bindings on-Worker,
// including Secrets Store bindings like SMTP_EMAIL which are objects, not strings).
import authGateway from "../../../auth-gateway/src/index";

function gatewayEnv(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, key: string) {
      const fromProcess = typeof process !== "undefined" ? process.env?.[key] : undefined;
      if (fromProcess !== undefined) return fromProcess;
      return ((globalThis as any).__visionWorkerEnv ?? (globalThis as any).__env__)?.[key];
    },
  });
}

export function handleGateway(request: Request): Promise<Response> {
  return authGateway.fetch(request, gatewayEnv() as any);
}
