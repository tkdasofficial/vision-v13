// Server-side helpers for fact-checking: safe full-page reads and owner-scoped persistence of claim records.
import type { ClaimRecord, FactCheckResult } from "./factcheck";

const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd]|.*\.(internal|local|localhost)$)/i;

/** Public http(s) page → readable text (scripts/styles/markup removed). Null when blocked, non-text, too big or unreachable. */
export async function fetchPageText(url: string, signal?: AbortSignal, timeoutMs = 6000): Promise<string | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await fetch(u.toString(), { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; VISION-factcheck/1.0)", Accept: "text/html,text/plain;q=0.9" } });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)|application\/xhtml/.test(type)) return null;
    const raw = (await r.text()).slice(0, 1_500_000);
    return htmlToText(raw).slice(0, 200_000);
  } catch { return null; }
  finally { clearTimeout(t); signal?.removeEventListener("abort", onAbort); }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s*\.\s*(\.\s*)+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

type Exec = (sql: string, params?: unknown[]) => Promise<any[]>;

/** Claim records are stored per user + message; every read and write is scoped by user id. */
export function claimCheckStore(exec: Exec, userId: string) {
  let ready: Promise<unknown> | null = null;
  const ensure = () => (ready ??= exec("CREATE TABLE IF NOT EXISTS claim_checks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT, message_id TEXT NOT NULL, records TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(user_id, message_id))").catch((e) => { ready = null; throw e; }));
  return {
    async save(messageId: string, conversationId: string | undefined, r: FactCheckResult) {
      await ensure();
      const records: ClaimRecord[] = r.records.map((c) => ({ ...c, support: c.support.slice(0, 3), conflict: c.conflict.slice(0, 3) }));
      const summary = { unchecked: r.unchecked.length, corrected: r.corrected, rounds: r.rounds, searchFailed: r.searchFailed, pagesRead: r.pagesRead, pagesFailed: r.pagesFailed };
      await exec(
        "INSERT INTO claim_checks (id, user_id, conversation_id, message_id, records, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, message_id) DO UPDATE SET records = excluded.records, summary = excluded.summary, created_at = excluded.created_at",
        [crypto.randomUUID(), userId, conversationId ?? null, messageId, JSON.stringify(records).slice(0, 200_000), JSON.stringify(summary), Date.now()],
      );
    },
    async get(messageId: string): Promise<{ records: ClaimRecord[]; summary: Record<string, number | boolean>; conversationId: string | null } | null> {
      await ensure();
      const row = (await exec("SELECT records, summary, conversation_id FROM claim_checks WHERE user_id = ? AND message_id = ? LIMIT 1", [userId, messageId]))[0];
      return row ? { records: JSON.parse(row.records), summary: JSON.parse(row.summary), conversationId: row.conversation_id } : null;
    },
  };
}
