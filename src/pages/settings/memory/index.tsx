import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Search, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings/settings-ui";
import { clearMemories, deleteMemory, editMemory, listMemories, type MemoryItem } from "@/lib/memory-client";

export default function MemorySettings() {
  const { prefs, update, loading } = useSettings();
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => listMemories().then((m) => { setItems(m); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => (items ?? []).filter((m) => m.content.toLowerCase().includes(q.trim().toLowerCase())), [items, q]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); return true; } catch (e: any) { toast.error(e.message); return false; } finally { setBusy(false); }
  };

  return (
    <SettingsPage title="Memory" loading={loading}>
      <SettingsSection title="Switches" description="VISION can remember helpful details across chats. You stay in control — turn it off, review, edit or delete anything at any time. Project chats with project-only memory never use these.">
        <SettingsToggle label="Reference saved memories" hint="Save and use details you share, like your name or preferences" checked={prefs.savedMemories} onChange={(v) => update({ savedMemories: v })} />
        <SettingsToggle label="Reference chat history" hint="Use relevant details from your earlier chats" checked={prefs.chatHistory} onChange={(v) => update({ chatHistory: v })} />
      </SettingsSection>

      <SettingsSection title="Saved memories" description="Say “Remember that…” in any chat to add one, or “Forget…” to remove it.">
        <div className="space-y-3 px-1 py-2">
          <label className="drawer-floating flex items-center gap-2 rounded-full px-4 py-2.5">
            <Search className="size-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories" aria-label="Search memories" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          </label>
          {error && <p className="px-2 text-sm text-destructive">{error} <Button variant="ghost" size="sm" onClick={load}>Retry</Button></p>}
          {!items && !error && <p className="flex items-center gap-2 px-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>}
          {items && !shown.length && <p className="px-2 py-4 text-center text-sm text-muted-foreground">{items.length ? "No memories match your search." : "No saved memories yet."}</p>}
          <ul className="space-y-2">
            {shown.map((m) => (
              <li key={m.id} className="drawer-floating rounded-3xl px-4 py-3">
                {editing?.id === m.id ? (
                  <div className="space-y-2">
                    <textarea value={editing.text} maxLength={500} rows={3} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} aria-label="Edit memory"
                      className="w-full resize-none bg-transparent text-sm text-foreground outline-none" />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel"><X className="size-4" /></Button>
                      <Button size="sm" variant="floating" disabled={busy || editing.text.trim().length < 2} aria-label="Save"
                        onClick={() => run(() => editMemory(m.id, editing.text), "Memory updated").then((ok) => { if (ok) setEditing(null); })}><Check className="size-4" /></Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm text-foreground">{m.content}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{m.source === "auto" ? "Learned from chat" : "You asked to remember"} · {m.category ?? "context"} · {m.status ?? "active"} · {new Date(m.updatedAt).toLocaleDateString()}</p>
                    </div>
                    <Button size="icon" variant="ghost" aria-label="Edit memory" onClick={() => setEditing({ id: m.id, text: m.content })}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Delete memory" disabled={busy} onClick={() => run(() => deleteMemory(m.id), "Memory deleted")}><Trash2 className="size-4" /></Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!!items?.length && (
            <Button variant="floating" disabled={busy} className="w-full rounded-full text-destructive"
              onClick={() => { if (confirm("Delete all saved memories? This can't be undone.")) run(clearMemories, "All memories deleted"); }}>
              Clear all memories
            </Button>
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
