// Server-only: one D1 round trip for prefs + the chat's project and memory setting (owner-checked).
import { d1 as rawD1 } from "@/lib/cloud/d1.server";

/** Bound every memory query: a hung D1 call must never hold up chat generation. */
export const MEMORY_DB_TIMEOUT_MS = 5000;
function d1(sql: string, params: unknown[] = []): Promise<any[]> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("memory db timeout")), MEMORY_DB_TIMEOUT_MS); });
  return Promise.race([rawD1(sql, params), timeout]).finally(() => clearTimeout(t));
}
import { resolveScope, rankProjectRows, projectRowsBlock, planMemoryWrite, memorySubject, type MemoryScope, type PermanentMemory, type WritePlan } from "./memory";
import { memoryCategory, memoryPrivacy, normalizeMemory } from "./memory-policy";

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
  // A failed settings read fails closed for personal memory, not open to defaults.
  return { prefsRaw: row ? row.prefs ?? null : { savedMemories: false, chatHistory: false }, projectId, scope: resolveScope(projectId, row?.memory), owned: !!row?.sid };
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
export const ensureMem = () => (memReady ??= (async () => {
  await d1("CREATE TABLE IF NOT EXISTS user_memories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)");
  const columns = await d1("PRAGMA table_info(user_memories)");
  for (const [name, definition] of Object.entries({ updated_at: "INTEGER", source: "TEXT DEFAULT 'explicit'", category: "TEXT NOT NULL DEFAULT 'context'", source_ref: "TEXT", canonical_key: "TEXT", status: "TEXT NOT NULL DEFAULT 'active'" })) {
    if (!columns.some((c) => c.name === name)) {
      try { await d1(`ALTER TABLE user_memories ADD COLUMN ${name} ${definition}`); }
      catch (error) { if (!/duplicate column/i.test(String(error))) throw error; }
    }
  }
  await d1("CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, created_at)");
  await d1("CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_canonical ON user_memories(user_id, canonical_key)");
  await d1("CREATE TABLE IF NOT EXISTS user_memory_state (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, history_blocked INTEGER NOT NULL DEFAULT 0)");
  await d1("CREATE TRIGGER IF NOT EXISTS memory_delete_privacy AFTER DELETE ON user_memories BEGIN INSERT INTO user_memory_state(user_id, revision, history_blocked) VALUES (OLD.user_id, 1, 1) ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1, history_blocked = 1; END");
  await d1("CREATE TRIGGER IF NOT EXISTS memory_prefs_revision AFTER UPDATE OF prefs ON user_settings BEGIN INSERT INTO user_memory_state(user_id, revision) VALUES (NEW.user_id, 1) ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1; END");
})().catch((e) => { memReady = null; throw e; }));

const ENABLED_SQL = "COALESCE((SELECT json_extract(CASE WHEN json_valid(prefs) THEN prefs ELSE '{}' END, '$.savedMemories') FROM user_settings WHERE user_id = user_memories.user_id LIMIT 1), 1) <> 0";
async function canonicalKey(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(memorySubject(content) ?? normalizeMemory(content)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Patch only the memory switches; unrelated settings survive concurrent changes. */
export async function setMemorySwitches(userId: string, patch: { savedMemories?: boolean; chatHistory?: boolean }): Promise<boolean> {
  try {
    await ensureMem();
    const rows = await d1("UPDATE user_settings SET prefs = json_patch(CASE WHEN json_valid(prefs) THEN prefs ELSE '{}' END, ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? RETURNING id", [JSON.stringify(patch), userId]);
    if (rows.length) return true;
    return (await d1("INSERT INTO user_settings (id, user_id, prefs) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM user_settings WHERE user_id = ?) RETURNING id", [crypto.randomUUID(), userId, JSON.stringify(patch), userId])).length > 0;
  } catch { return false; }
}
export const setMemoryEnabled = (userId: string, enabled: boolean) => setMemorySwitches(userId, { savedMemories: enabled, chatHistory: enabled });

export async function memoryRevision(userId: string): Promise<number | null> {
  try { await ensureMem(); const rows = await d1("SELECT revision FROM user_memory_state WHERE user_id = ?", [userId]); return Number(rows[0]?.revision ?? 0); } catch { return null; }
}

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
export async function savePermanentMemory(userId: string, content: string, source: "explicit" | "auto" = "explicit", sourceRef?: string, expectedRevision?: number): Promise<SaveResult> {
  const trimmed = content.trim();
  if (trimmed.length < 2 || trimmed.length > 500 || memoryPrivacy(trimmed) === "secret" || (source === "auto" && memoryPrivacy(trimmed) !== "safe")) return null;
  try {
    await ensureMem();
    const enabled = (await d1("SELECT COALESCE((SELECT json_extract(CASE WHEN json_valid(prefs) THEN prefs ELSE '{}' END, '$.savedMemories') FROM user_settings WHERE user_id = ? LIMIT 1),1) AS enabled", [userId]))[0]?.enabled;
    if (enabled === 0) return null;
    const state = (await d1("SELECT revision FROM user_memory_state WHERE user_id = ?", [userId]))[0];
    const revision = Number(state?.revision ?? 0);
    if (expectedRevision !== undefined && expectedRevision !== revision) return null;
    const existing = await loadPermanentMemoriesStrict(userId);
    const plan = planMemoryWrite(existing, trimmed);
    const now = Date.now();
    const category = memoryCategory(trimmed);
    const key = await canonicalKey(trimmed);
    if (plan.kind === "duplicate") {
      const memory = existing.find((m) => m.id === plan.id);
      return memory ? { memory, plan } : null;
    }
    if (plan.kind === "replace") {
      const previous = existing.find((m) => m.id === plan.id);
      // Automatic extraction must never overwrite an explicit instruction/correction.
      if (source === "auto" && previous?.source !== "auto") return previous ? { memory: previous, plan: { kind: "duplicate", id: previous.id } } : null;
    const r: any[] = await d1(`UPDATE user_memories SET content = ?1, updated_at = ?2, source = ?3, category = ?4, source_ref = ?5, canonical_key = ?6 WHERE content = ?8 AND COALESCE((SELECT revision FROM user_memory_state WHERE user_id = ?10),0) = ?7 AND ${ENABLED_SQL} AND id = ?9 AND user_id = ?10 RETURNING id`, [trimmed, now, source, category, sourceRef ?? null, key, revision, plan.previous, plan.id, userId]);
      if (!r.length) return null;
      return { memory: { id: plan.id, content: trimmed, createdAt: now }, plan };
    }
    const mem: PermanentMemory = { id: crypto.randomUUID(), content: trimmed, createdAt: now };
    const inserted = await d1("INSERT INTO user_memories (id, user_id, content, created_at, updated_at, source, category, source_ref, canonical_key) SELECT ?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8 WHERE COALESCE((SELECT revision FROM user_memory_state WHERE user_id = ?2),0) = ?9 AND COALESCE((SELECT json_extract(CASE WHEN json_valid(prefs) THEN prefs ELSE '{}' END, '$.savedMemories') FROM user_settings WHERE user_id = ?2 LIMIT 1),1) <> 0 ON CONFLICT(user_id, canonical_key) DO NOTHING RETURNING id", [mem.id, userId, mem.content, now, source, category, sourceRef ?? null, key, revision]);
    if (!inserted.length) {
      const match = (await loadPermanentMemoriesStrict(userId)).find((m) => normalizeMemory(m.content) === normalizeMemory(trimmed));
      return match ? { memory: match, plan: { kind: "duplicate", id: match.id } } : null;
    }
    return { memory: mem, plan };
  } catch {
    return null;
  }
}

async function loadPermanentMemoriesStrict(userId: string): Promise<PermanentMemory[]> {
  const rows: any[] = await d1("SELECT id, content, created_at, updated_at, source, category, source_ref FROM user_memories WHERE user_id = ? AND status = 'active' ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 500", [userId]);
  return rows.map((r) => ({ id: String(r.id), content: String(r.content ?? ""), createdAt: Number(r.updated_at ?? r.created_at) || 0, source: String(r.source ?? "explicit"), category: String(r.category ?? "context"), sourceRef: r.source_ref ?? undefined })).filter((m) => m.content);
}

/** Deletes specific memories owned by this user. Returns the number deleted, or null on failure. */
export async function deletePermanentMemories(userId: string, ids: string[] | "all"): Promise<number | null> {
  try {
    await ensureMem();
    if (ids === "all") {
      await d1("INSERT INTO user_memory_state (user_id, revision, history_blocked) VALUES (?, 1, 1) ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1, history_blocked = 1", [userId]);
      return (await d1("DELETE FROM user_memories WHERE user_id = ? RETURNING id", [userId])).length;
    }
    if (!ids.length) return 0;
    if (ids.length === 1) return (await d1("DELETE FROM user_memories WHERE id = ? AND user_id = ? RETURNING id", [ids[0], userId])).length;
    return (await d1(`DELETE FROM user_memories WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")}) RETURNING id`, [userId, ...ids])).length;
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

export type MemoryItem = { id: string; content: string; createdAt: number; updatedAt: number; source: string; category: string; sourceRef: string | null; status: string };

/** Full list for Settings → Memory (owner-scoped). Null on failure. */
export async function listMemoryItems(userId: string): Promise<MemoryItem[] | null> {
  try {
    await ensureMem();
    const rows: any[] = await d1("SELECT id, content, created_at, updated_at, source, category, source_ref, status FROM user_memories WHERE user_id = ? AND status = 'active' ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 500", [userId]);
    return rows.map((r) => ({ id: String(r.id), content: String(r.content ?? ""), createdAt: Number(r.created_at) || 0, updatedAt: Number(r.updated_at ?? r.created_at) || 0, source: String(r.source ?? "explicit"), category: String(r.category ?? "context"), sourceRef: r.source_ref ?? null, status: r.status ?? "active" }));
  } catch { return null; }
}

/** Edits one memory the user owns. Returns false when nothing was changed. */
export async function editMemory(userId: string, id: string, content: string): Promise<boolean> {
  const t = content.trim();
  if (t.length < 2 || t.length > 500 || memoryPrivacy(t) === "secret") return false;
  try {
    await ensureMem();
    return (await d1("UPDATE user_memories SET content = ?, updated_at = ?, source = 'explicit', category = ?, canonical_key = ? WHERE id = ? AND user_id = ? RETURNING id", [t, Date.now(), memoryCategory(t), await canonicalKey(t), id, userId])).length > 0;
  } catch { return false; }
}

/** Relevant snippets from the user's other non-project chats ("Reference chat history"). Fails soft to "". */
export async function loadPastChatsMemory(userId: string, chatId: string | undefined, text: string): Promise<string> {
  if (!text.trim()) return "";
  // Deletion preserves conversations, but never mines them to resurrect forgotten facts.
  try { await ensureMem(); const state = await d1("SELECT history_blocked FROM user_memory_state WHERE user_id = ?", [userId]); if (state[0]?.history_blocked) return ""; } catch { return ""; }
  const { rankPastChats, pastChatsBlock } = await import("./memory");
  const rows: any[] = await d1(
    `SELECT s.id AS chatId, s.title AS title, m.role AS role, m.content AS content, m.created_at AS createdAt
     FROM chat_sessions s JOIN chat_messages m ON m.session_id = s.id
     WHERE s.user_id = ? AND s.project_id IS NULL AND s.id <> ? AND m.role IN ('user','assistant')
     ORDER BY m.created_at DESC LIMIT 200`,
    [userId, chatId ?? ""],
  ).catch(() => []);
  const norm = rows.map((r) => ({ chatId: String(r.chatId), title: String(r.title ?? ""), role: String(r.role), content: String(r.content ?? ""), createdAt: String(r.createdAt ?? "") }));
  return pastChatsBlock(rankPastChats(norm, chatId ?? "", text));
}
