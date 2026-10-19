import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { ChatMessage } from "@/lib/types";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "./AuthContext";
import { idbGet, idbSet, idbDelete, idbClear } from "@/lib/idb-cache";

export type ChatHistoryItem = {
  id: string;
  title: string;
  toolId?: string;
  preview: string;
  date: string;
  createdAt: number;
  messages: ChatMessage[];
  projectId?: string | null;
  pinned?: boolean;
};

type ChatHistoryContextType = {
  history: ChatHistoryItem[];
  loading: boolean;
  addChat: (title: string, preview: string, toolId?: string, projectId?: string | null) => string;
  renameChat: (id: string, newTitle: string) => void;
  deleteChat: (id: string) => void;
  searchHistory: (query: string) => ChatHistoryItem[];
  updateChatMessages: (id: string, messages: ChatMessage[]) => void;
  persistChatMessages: (id: string, messages: ChatMessage[]) => Promise<void>;
  getChatById: (id: string) => ChatHistoryItem | undefined;
  loadChatMessages: (id: string) => Promise<ChatMessage[]>;
  setChatProject: (id: string, projectId: string | null) => Promise<boolean>;
  togglePin: (id: string) => void;
};

// Keep one context instance across hot reloads so the provider and consumers always match.
const CTX_KEY = "__sc_chat_history_ctx__";
const ChatHistoryContext: import("react").Context<ChatHistoryContextType | null> =
  ((globalThis as any)[CTX_KEY] ??= createContext<ChatHistoryContextType | null>(null));

/* ── localStorage cache helpers ── */
const LS_SESSIONS_KEY = "sc_chat_sessions";
const LS_MESSAGES_PREFIX = "sc_chat_msgs_";
const LS_MAX_CACHED_CHATS = 50;

function lsGetSessions(): ChatHistoryItem[] {
  try {
    const raw = localStorage.getItem(LS_SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function lsSetSessions(items: ChatHistoryItem[]) {
  try {
    // Store without messages to keep size small
    const slim = items.slice(0, LS_MAX_CACHED_CHATS).map(({ messages, ...rest }) => ({ ...rest, messages: [] }));
    localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(slim));
  } catch { /* quota exceeded — silently ignore */ }
}

function lsGetMessages(sessionId: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(LS_MESSAGES_PREFIX + sessionId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function lsSetMessages(sessionId: string, msgs: ChatMessage[]) {
  void idbSet(LS_MESSAGES_PREFIX + sessionId, msgs);
  try {
    localStorage.setItem(LS_MESSAGES_PREFIX + sessionId, JSON.stringify(msgs));
  } catch { /* quota exceeded */ }
}

function lsRemoveMessages(sessionId: string) {
  void idbDelete(LS_MESSAGES_PREFIX + sessionId);
  try { localStorage.removeItem(LS_MESSAGES_PREFIX + sessionId); } catch {}
}

const getDateLabel = (ts: number): string => {
  const now = new Date();
  const d = new Date(ts);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** Same local message id → same database row id, across remounts and reloads (prevents duplicate rows). */
function stableRowId(sessionId: string, localId: string): string {
  // Already a durable server row, not a temporary browser id.
  if (/^job-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(localId)) return localId;
  let h = "";
  for (let seed = 0; seed < 4; seed++) {
    let x = 0x811c9dc5 ^ seed;
    for (const ch of `${sessionId}:${localId}`) x = Math.imul(x ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    h += x.toString(16).padStart(8, "0");
  }
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Serialize a ChatMessage's extra data into a JSONB-safe metadata object */
export function buildMetadata(msg: ChatMessage): Record<string, any> {
  const meta: Record<string, any> = {};
  if (msg.toolId) meta.toolId = msg.toolId;
  if (msg.webApp) meta.webApp = msg.webApp;
  if (msg.document) meta.document = msg.document;
  if (msg.executionMode) meta.executionMode = msg.executionMode;
  if (msg.deep?.stage === "done" || msg.deep?.stage === "failed") meta.deep = { stage: msg.deep.stage, seconds: msg.deep.seconds, detail: msg.deep.detail };
  if (msg.activity) meta.activity = { ...msg.activity };
  if (msg.pasted?.length) meta.pasted = msg.pasted;
  if (msg.typed !== undefined) meta.typed = msg.typed;
  if (msg.attachments?.length) meta.attachments = msg.attachments;
  if (msg.deleted) meta.deleted = true;
  if (msg.job && (msg.deleted || msg.archivedJob)) meta.job = msg.job;
  if (msg.archivedJob) meta.archivedJob = true;
  return meta;
}

/** Reconstruct a ChatMessage from a DB row */
function rowToMessage(row: any): ChatMessage {
  const meta = (row.metadata || {}) as Record<string, any>;
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    timestamp: new Date(row.created_at),
    imageUrl: row.image_url || undefined,
    toolId: meta.toolId,
    webApp: meta.webApp,
    document: meta.document,
    executionMode: meta.executionMode,
    deep: meta.deep ? { stage: meta.deep.stage === "failed" ? "failed" : "done", seconds: meta.deep.seconds, detail: meta.deep.detail } : undefined,
    activity: Array.isArray(meta.activity?.steps) && Number.isFinite(Number(meta.activity.seconds)) ? { seconds: Number(meta.activity.seconds), steps: meta.activity.steps.map(String), ...(meta.activity.failed ? { failed: true } : {}), ...(meta.activity.detail ? { detail: String(meta.activity.detail) } : {}) } : undefined,
    pasted: meta.pasted,
    typed: meta.typed,
    attachments: meta.attachments,
    deleted: meta.deleted === true,
    archivedJob: meta.archivedJob === true,
    job: meta.job,
  };
}

/** Rows → messages in true conversation order, without copies left by older saving bugs.
 * Ties on created_at (older rows saved in one batch share a timestamp) put the question before its answer.
 * A repeated message is hidden only when it is an exact copy of an earlier one with no reply of its own;
 * stored rows are never deleted. */
export function rowsToConversation(rows: any[]): ChatMessage[] {
  const sorted = rows.map((r, i) => ({ r, i, t: Date.parse(r.created_at) || 0 })).sort((a, b) =>
    a.t - b.t || (a.r.role === b.r.role ? a.i - b.i : a.r.role === "user" ? -1 : 1));
  const msgs = sorted.map((x) => rowToMessage(x.r));
  const seen = new Set<string>();
  return msgs.filter((m, i) => {
    if (m.deleted || m.archivedJob) return true;
    const key = `${m.role}\u0000${m.content}\u0000${m.imageUrl ?? ""}`;
    const dup = seen.has(key);
    seen.add(key);
    if (!dup) return true;
    if (m.role === "assistant") return false;
    const next = msgs[i + 1];
    return !!next && next.role === "assistant"; // a repeated question that did get its own answer is real
  });
}

export const ChatHistoryProvider = ({ children }: { children: ReactNode }) => {
  // Initialize from localStorage cache for instant render
  const [history, setHistory] = useState<ChatHistoryItem[]>(() => lsGetSessions());
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const prevUserRef = useRef<string | null>(null);
  const sessionWrites = useRef(new Map<string, Promise<void>>());

  // Sync history to localStorage whenever it changes
  useEffect(() => {
    if (history.length > 0) lsSetSessions(history);
  }, [history]);

  // Load sessions from Supabase on mount / user change
  useEffect(() => {
    if (!user) {
      // Signed out after being signed in: drop cached private chats from this browser.
      if (prevUserRef.current) void idbClear();
      prevUserRef.current = null;
      setHistory([]);
      setLoading(false);
      return;
    }

    prevUserRef.current = user.id;
    let cancelled = false;

    const loadSessions = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (cancelled) return;

      if (error) {
        console.error("Failed to load chat sessions:", error);
        setLoading(false);
        return;
      }

      const items: ChatHistoryItem[] = (data || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        toolId: s.tool_id,
        preview: s.preview,
        date: getDateLabel(new Date(s.created_at).getTime()),
        createdAt: new Date(s.created_at).getTime(),
        messages: [],
        projectId: s.project_id || null,
        pinned: !!s.pinned,
      }));

      setHistory(items);
      setLoading(false);
    };

    loadSessions();
    return () => { cancelled = true; };
  }, [user]);

  // Load messages for a specific chat session
  // Always reads the saved conversation (the local copy is only a fallback when offline).
  // Throws Error("not_found") when the chat doesn't exist or isn't this user's, Error("unavailable") when unreachable.
  const loadChatMessages = useCallback(async (sessionId: string): Promise<ChatMessage[]> => {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load chat messages:", error);
      const cached = lsGetMessages(sessionId);
      if (cached && cached.length > 0) return cached;
      const stored = await idbGet<ChatMessage[]>(LS_MESSAGES_PREFIX + sessionId);
      if (stored && stored.length > 0) return stored;
      throw new Error("unavailable");
    }
    if (!data || data.length === 0) {
      const { data: session, error: sErr } = await supabase.from("chat_sessions").select("id").eq("id", sessionId).maybeSingle();
      if (sErr) throw new Error("unavailable");
      if (!session) { lsRemoveMessages(sessionId); throw new Error("not_found"); }
    }
    const msgs = rowsToConversation(data || []);
    lsSetMessages(sessionId, msgs);
    setHistory((prev) => prev.map((h) => (h.id === sessionId ? { ...h, messages: msgs } : h)));
    return msgs;
  }, []);

  const addChat = useCallback((title: string, preview: string, toolId?: string, projectId: string | null = null) => {
    // Create a temporary ID for immediate UI update
    const tempId = crypto.randomUUID();
    const item: ChatHistoryItem = {
      projectId,
      id: tempId,
      title,
      preview,
      toolId,
      date: getDateLabel(Date.now()),
      createdAt: Date.now(),
      messages: [],
    };
    setHistory((prev) => [item, ...prev]);

    // Persist to Supabase in background
    if (user) {
      const write = Promise.resolve(supabase
        .from("chat_sessions")
        .insert({
          id: tempId,
          user_id: user.id,
          title,
          preview,
          tool_id: toolId || null,
          project_id: projectId,
        })
        ).then(({ error }) => {
          if (error) throw new Error("Couldn't save this chat. Please try again.");
        });
      sessionWrites.current.set(tempId, write);
      void write.catch(() => {});
    }

    return tempId;
  }, [user]);

  const renameChat = useCallback((id: string, newTitle: string) => {
    setHistory((prev) => prev.map((c) => (c.id === id ? { ...c, title: newTitle } : c)));

    supabase
      .from("chat_sessions")
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error("Failed to rename chat:", error);
      });
  }, []);

  const deleteChat = useCallback((id: string) => {
    setHistory((prev) => prev.filter((c) => c.id !== id));
    lsRemoveMessages(id);

    supabase
      .from("chat_sessions")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error("Failed to delete chat:", error);
      });
  }, []);

  const setChatProject = useCallback(async (id: string, projectId: string | null) => {
    const { error } = await supabase.from("chat_sessions").update({ project_id: projectId, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { console.error("Failed to move chat:", error); return false; }
    setHistory((prev) => prev.map((c) => (c.id === id ? { ...c, projectId } : c)));
    return true;
  }, []);

  const togglePin = useCallback((id: string) => {
    let next = false;
    setHistory((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: (next = !c.pinned) } : c)));
    setTimeout(() => {
      supabase.from("chat_sessions").update({ pinned: next }).eq("id", id).then(({ error }) => { if (error) console.error("Failed to pin chat:", error); });
    }, 0);
  }, []);

  const searchHistory = useCallback(
    (query: string) => {
      if (!query.trim()) return history;
      const q = query.toLowerCase();
      return history.filter(
        (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)
      );
    },
    [history]
  );

  const savedRef = useRef(new Map<string, string>());
  // Before dispatching background work, commit its question and session. A page can close before
  // the ordinary debounced save fires, but the accepted task must have a durable conversation.
  const persistChatMessages = useCallback(async (id: string, messages: ChatMessage[]) => {
    await sessionWrites.current.get(id);
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pending = messages.filter((m) => (m.content || m.deleted) && (!m.job || m.deleted || m.archivedJob) && savedRef.current.get(m.id) !== JSON.stringify([m.content, buildMetadata(m)]));
    if (!pending.length) return;
    // An older debounced snapshot must not overwrite an immediate edit/tombstone.
    clearTimeout(saveTimers.current[id]);
    pendingRows.current[id]?.clear();
    let last = 0;
    const rows = pending.map((m) => {
      last = Math.max(last + 1, new Date(m.timestamp).getTime() || Date.now());
      return { id: UUID.test(m.id) ? m.id : stableRowId(id, m.id), session_id: id, role: m.role, content: m.content,
        created_at: new Date(last).toISOString(), image_url: m.imageUrl || null, metadata: buildMetadata(m) };
    });
    const { error } = await supabase.from("chat_messages").upsert(rows, { onConflict: "id" });
    if (error) throw new Error("Couldn't save your message. Please try again.");
    pending.forEach((m) => savedRef.current.set(m.id, JSON.stringify([m.content, buildMetadata(m)])));
    setHistory((prev) => prev.map((c) => c.id === id ? { ...c, messages } : c));
    lsSetMessages(id, messages.filter((m) => !m.job || m.deleted || m.archivedJob));
  }, []);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingRows = useRef<Record<string, Map<string, { row: any; msg: ChatMessage }>>>({});
  const updateChatMessages = useCallback((id: string, messages: ChatMessage[]) => {
    setHistory((prev) => prev.map((c) => (c.id === id ? { ...c, messages } : c)));
    // Debounced save of messages that are new or changed since the last save.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // Cache with the database ids so a reload re-saves the same rows instead of creating duplicates.
    lsSetMessages(id, messages.filter((m) => !m.job || m.deleted || m.archivedJob).map((m) => {
      if (UUID.test(m.id)) return m;
      return { ...m, id: stableRowId(id, m.id) };
    }));
    // Task messages are restored from the server's task records, so they are not saved as chat rows.
    const pending = messages.filter((m) => (m.content || m.deleted) && (!m.job || m.deleted || m.archivedJob) && savedRef.current.get(m.id) !== JSON.stringify([m.content, buildMetadata(m)]));
    if (pending.length === 0) return;
    // Each row carries its own strictly increasing time so the question always sorts before its answer
    // (rows saved in one batch used to share the server's "now").
    const times = new Map<string, string>();
    let last = 0;
    for (const m of messages) {
      let t = new Date(m.timestamp as any).getTime() || Date.now();
      if (t <= last) t = last + 1;
      last = t;
      times.set(m.id, new Date(t).toISOString());
    }
    const rows = pending.map((m) => {
      return {
        created_at: times.get(m.id),
        id: UUID.test(m.id) ? m.id : stableRowId(id, m.id),
        session_id: id,
        role: m.role as string,
        content: m.content,
        image_url: m.imageUrl || null,
        metadata: buildMetadata(m) as any,
      };
    });
    // Merge with rows still waiting from earlier calls so a rapid follow-up save never drops them.
    const queue = (pendingRows.current[id] ??= new Map());
    rows.forEach((r, i) => queue.set(r.id, { row: r, msg: pending[i] }));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      const batch = [...queue.values()];
      queue.clear();
      const allRows = batch.map((b) => b.row);
      const allMsgs = batch.map((b) => b.msg);
      allMsgs.forEach((m) => savedRef.current.set(m.id, JSON.stringify([m.content, buildMetadata(m)])));
    supabase
      .from("chat_messages")
      .upsert(allRows, { onConflict: "id" })
      .then(({ error }) => {
        if (error) { console.error("Failed to save messages:", error); allMsgs.forEach((m) => savedRef.current.delete(m.id)); }
      });
      supabase.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", id).then(() => {});
    }, 800);
  }, []);

  const getChatById = useCallback((id: string) => {
    return history.find((c) => c.id === id);
  }, [history]);

  return (
    <ChatHistoryContext.Provider
      value={{
        history,
        loading,
        addChat,
        renameChat,
        deleteChat,
        searchHistory,
        updateChatMessages,
        persistChatMessages,
        getChatById,
        loadChatMessages,
        setChatProject,
        togglePin,
      }}
    >
      {children}
    </ChatHistoryContext.Provider>
  );
};

const FALLBACK_HISTORY: ChatHistoryContextType = {
  history: [],
  loading: true,
  addChat: () => crypto.randomUUID(),
  renameChat: () => {},
  deleteChat: () => {},
  searchHistory: () => [],
  updateChatMessages: () => {},
  persistChatMessages: async () => {},
  getChatById: () => undefined,
  loadChatMessages: async () => [],
  setChatProject: async () => false,
  togglePin: () => {},
};

export const useChatHistory = () => {
  const ctx = useContext(ChatHistoryContext);
  // Fall back to an empty, no-op history instead of blanking the screen
  // (e.g. during a hot reload before the provider re-mounts).
  return ctx ?? FALLBACK_HISTORY;
};
