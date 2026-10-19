// Server-only: one D1 round trip for prefs + the chat's project and memory setting (owner-checked).
import { d1 as rawD1 } from "@/lib/cloud/d1.server";

/** Bound every memory query: a hung D1 call must never hold up chat generation. */
export const MEMORY_DB_TIMEOUT_MS = 5000;
function d1(sql: string, params: unknown[] = []): Promise<any[]> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("memory db timeout")), MEMORY_DB_TIMEOUT_MS); });
  return Promise.race([rawD1(sql, params), timeout]).finally(() => clearTimeout(t));
}
import { resolveScope, rankProjectRows, projectRowsBlock, planMemoryWrite, type MemoryScope, type PermanentMemory, type WritePlan } from "./memory";

export async function loadChatContext(userId: string, chatId: string | undefined): Promise<{ prefsRaw: unknown; projectId: string | null; scope: MemoryScope; owned: boolean }> {
  const cid = chatId && /^[\w-]{1,64}$/.test(chatId) ? chatId : "";
  const row: any = (await d1(
    `SELECT (SELECT prefs FROM user_settings WHERE user_id = ?1 LIMIT 1) AS prefs,
            p.id AS project_id, p.memory AS memory, s.id AS sid
     FROM (SELECT 1) LEFT JOIN chat_sessions s ON s.id = ?2 AND s.user_id = ?1
     LEFT JOIN workspace_projects p ON p.id = s.project_id AND p.user_id = ?1`,
    [userId, cid],
  ).catch(() => []))[0];
  const projectId = row?.project_id ?? null;
  return { prefsRaw: row?.prefs ?? null, projectId, scope: resolveScope(projectId, row?.memory), owned: !!row?.sid };
}

/**
 * Relevant requests AND outputs from other chats of the same project, owned by the same user
 * (owner + project checked in SQL and again in rankProjectRows). Fails soft to "".
 */
export async function loadProjectMemory(userId: string, projectId: string, chatId: string, text = ""): Promise<string> {
  const rows: any[] = await d1(
    `SELECT s.id AS chatId, s.title AS title, s.project_id AS projectId, m.role AS role, m.content AS content, m.created_at AS createdAt
     FROM chat_sessions s JOIN chat_messages m ON m.session_id = s.id
     WHERE s.user_id = ? AND s.project_id = ? AND s.id <> ? AND m.role IN ('user','assistant')
     ORDER BY m.created_at DESC LIMIT 120`,
    [userId, projectId, chatId],
  ).catch(() => []);
  const norm = rows.map((r) => ({ ...r, role: String(r.role), createdAt: String(r.createdAt ?? ""), content: String(r.content ?? ""), title: String(r.title ?? "") }));
  return projectRowsBlock(rankProjectRows(norm, projectId, chatId, text));
}

// ---- Permanent memory (user-level, explicit saves only). Fails soft: memory never breaks chat. ----

let memReady: Promise<unknown> | null = null;
const ensureMem = () => (memReady ??= d1(
  "CREATE TABLE IF NOT EXISTS user_memories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)",
).then(() => d1("ALTER TABLE user_memories ADD COLUMN updated_at INTEGER").catch(() => undefined))
 .then(() => d1("ALTER TABLE user_memories ADD COLUMN source TEXT DEFAULT 'explicit'").catch(() => undefined))
 .then(() => d1("CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, created_at)")).catch((e) => { memReady = null; throw e; }));

/** Like loadPermanentMemories but null on failure, so callers can tell "none stored" from "couldn't read". */
export async function tryLoadPermanentMemories(userId: string): Promise<PermanentMemory[] | null> {
  try { await ensureMem(); return await loadPermanentMemoriesStrict(userId); } catch { return null; }
}

/** Loads the user's permanent memories, newest first. Returns [] on any failure. */
export async function loadPermanentMemories(userId: string): Promise<PermanentMemory[]> {
  try {
    await ensureMem();
    return await loadPermanentMemoriesStrict(userId);
  } catch {
    return [];
  }
}

export type SaveResult = { memory: PermanentMemory; plan: WritePlan } | null;

/**
 * Saves a fact for this user only. Duplicate → no-op, same subject → replaced (latest wins),
 * else inserted. Returns null on any failure so callers never claim a save that didn't happen.
 */
export async function savePermanentMemory(userId: string, content: string, source: "explicit" | "auto" = "explicit"): Promise<SaveResult> {
  const trimmed = content.trim();
  if (trimmed.length < 2 || trimmed.length > 500) return null;
  try {
    await ensureMem();
    const existing = await loadPermanentMemoriesStrict(userId);
    const plan = planMemoryWrite(existing, trimmed);
    const now = Date.now();
    if (plan.kind === "duplicate") {
      const memory = existing.find((m) => m.id === plan.id);
      return memory ? { memory, plan } : null;
    }
    if (plan.kind === "replace") {
      const r: any[] = await d1("UPDATE user_memories SET content = ?, updated_at = ?, source = ? WHERE id = ? AND user_id = ? RETURNING id", [trimmed, now, source, plan.id, userId]);
      if (!r.length) return null;
      return { memory: { id: plan.id, content: trimmed, createdAt: now }, plan };
    }
    const mem: PermanentMemory = { id: crypto.randomUUID(), content: trimmed, createdAt: now };
    const inserted = await d1("INSERT INTO user_memories (id, user_id, content, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?) RETURNING id", [mem.id, userId, mem.content, now, now, source]);
    if (!inserted.length) return null;
    return { memory: mem, plan };
  } catch {
    return null;
  }
}

async function loadPermanentMemoriesStrict(userId: string): Promise<PermanentMemory[]> {
  const rows: any[] = await d1("SELECT id, content, created_at, updated_at FROM user_memories WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 200", [userId]);
  return rows.map((r) => ({ id: String(r.id), content: String(r.content ?? ""), createdAt: Number(r.updated_at ?? r.created_at) || 0 })).filter((m) => m.content);
}

/** Deletes specific memories owned by this user. Returns the number deleted, or null on failure. */
export async function deletePermanentMemories(userId: string, ids: string[] | "all"): Promise<number | null> {
  try {
    await ensureMem();
    if (ids === "all") return (await d1("DELETE FROM user_memories WHERE user_id = ? RETURNING id", [userId])).length;
    let n = 0;
    for (const id of ids) n += (await d1("DELETE FROM user_memories WHERE id = ? AND user_id = ? RETURNING id", [id, userId])).length;
    return n;
  } catch {
    return null;
  }
}

/** Restore this user's saved conversation before budgeting or resolving references. */
export async function loadConversationHistory(userId: string, chatId: string | undefined): Promise<{ role: "user" | "assistant"; content: string }[]> {
  if (!chatId || !/^[\w-]{1,64}$/.test(chatId)) return [];
  const rows = await d1(`SELECT m.role, m.content FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
    WHERE s.id = ? AND s.user_id = ? AND m.role IN ('user','assistant') ORDER BY m.created_at ASC LIMIT 1000`, [chatId, userId]).catch(() => []);
  return rows.filter((r) => typeof r.content === "string" && r.content.trim()).map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", content: r.content }));
}
