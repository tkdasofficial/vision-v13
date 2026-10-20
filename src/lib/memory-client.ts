// Browser client for Settings → Memory and the "Memory updated" notice.
export type MemoryItem = { id: string; content: string; createdAt: number; updatedAt: number; source: string; category?: string; sourceRef?: string | null; status?: string };

async function call<T>(method: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/memories", { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Memory request failed.");
  return data as T;
}
export const listMemories = () => call<{ memories: MemoryItem[] }>("GET").then((d) => d.memories);
export const editMemory = (id: string, content: string) => call("PATCH", { id, content });
export const deleteMemory = (id: string) => call("DELETE", { ids: [id] });
export const clearMemories = () => call("DELETE", { all: true });

/** True when any memory was written at or after `since` (ms). */
export function changedSince(items: MemoryItem[], since: number): boolean {
  return items.some((m) => m.updatedAt >= since - 1000);
}
