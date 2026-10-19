import { REPO_LIMITS, RepoError, errorFor } from "./common";

export type Fetch = typeof fetch;
const UA = "VISION-repo-analyzer/1.0";

/** Anonymous GET with a timeout and a size cap; maps HTTP failures to user-facing RepoErrors. */
export async function get(url: string, what: string, opts: { f?: Fetch; accept?: string; allow404?: boolean; rateHeader?: (h: Headers) => boolean } = {}): Promise<Response | null> {
  let res: Response;
  try {
    res = await (opts.f ?? fetch)(url, { headers: { "User-Agent": UA, Accept: opts.accept ?? "application/json" }, redirect: "follow", signal: AbortSignal.timeout(REPO_LIMITS.timeoutMs) });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new RepoError("timeout", `${what} took too long to answer.`);
    throw new RepoError("unavailable", `${what} couldn't be reached.`);
  }
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) throw errorFor(res.status, what, opts.rateHeader?.(res.headers) ?? false);
  return res;
}

export async function json(url: string, what: string, opts: Parameters<typeof get>[2] = {}): Promise<any> {
  const r = await get(url, what, opts);
  if (!r) return null;
  try { return await r.json(); } catch { throw new RepoError("unavailable", `${what} sent an unreadable response.`); }
}

/** Text file body, cut at the size cap; binary content is skipped. */
export async function text(url: string, what: string, opts: Parameters<typeof get>[2] = {}): Promise<string | null> {
  const r = await get(url, what, { ...opts, accept: opts.accept ?? "text/plain, */*", allow404: true });
  if (!r) return null;
  const buf = new Uint8Array(await r.arrayBuffer()).subarray(0, REPO_LIMITS.maxFileBytes);
  if (buf.includes(0)) return null;
  return new TextDecoder().decode(buf);
}
