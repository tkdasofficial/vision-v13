// Server-only access to the "vision-sandbox" D1 database: the temporary output
// generation store for the Long Context Generation system. On the Worker it uses
// the SANDBOX_DB binding; elsewhere it falls back to the Cloudflare API with
// CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN. Never exposed to the client.
import { getD1Binding } from "../ai/runtime-env.server";

const DATABASE_ID = "4d8098d8-e148-46ea-9e79-b4d35c148c8f";

export type SandboxDb = (sql: string, params?: unknown[]) => Promise<any[]>;

function binding() {
  const env = ((globalThis as any).__visionWorkerEnv ?? (globalThis as any).__env__) as Record<string, unknown> | undefined;
  const db = env?.["SANDBOX_DB"] as any;
  return db && typeof db.prepare === "function" ? db : undefined;
}

/** True when the sandbox store is reachable (Worker binding or REST credentials). */
export function sandboxReady(): boolean {
  return !!binding() || !!(process.env["CLOUDFLARE_ACCOUNT_ID"] && process.env["CLOUDFLARE_API_TOKEN"]);
}

export const sandboxDb: SandboxDb = async (sql, params = []) => {
  const b = binding();
  if (b) {
    const res = await b.prepare(sql).bind(...params).all();
    return (res.results ?? []) as any[];
  }
  const account = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  if (!account || !token) throw new Error("Sandbox database is not configured");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE_ID}/query`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }) },
  );
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    console.error("[sandbox:d1] query failed", res.status, JSON.stringify(body?.errors ?? body));
    throw new Error("Sandbox database request failed");
  }
  return (body.result?.[0]?.results ?? []) as any[];
};

export { getD1Binding as _mainD1Binding };
