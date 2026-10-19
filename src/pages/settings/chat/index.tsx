import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Download, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";
import { ConfirmBox, SettingsPage, SettingsSection } from "@/components/settings/settings-ui";

export async function exportChats(userId: string) {
  const { data: sessions, error } = await supabase.from("chat_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (sessions || []).map((s: any) => s.id);
  const { data: messages } = ids.length ? await supabase.from("chat_messages").select("*").in("session_id", ids) : { data: [] as any[] };
  return (sessions || []).map((s: any) => ({ ...s, messages: (messages || []).filter((m: any) => m.session_id === s.id) }));
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export default function ChatHistory() {
  const { user } = useAuth();
  const [busy, setBusy] = useState<"" | "export" | "clear">("");
  const [confirm, setConfirm] = useState(false);

  const onExport = async () => {
    if (!user) return; setBusy("export");
    try { download(`vision-chats-${new Date().toISOString().slice(0, 10)}.json`, await exportChats(user.id)); toast.success("Chats downloaded"); }
    catch { toast.error("Couldn't export chats."); }
    setBusy("");
  };
  const onClear = async () => {
    if (!user) return; setBusy("clear");
    const { error } = await supabase.from("chat_sessions").delete().eq("user_id", user.id);
    setBusy(""); setConfirm(false);
    if (error) toast.error("Couldn't clear history."); else { toast.success("All chats deleted"); window.dispatchEvent(new Event("vision:history-cleared")); }
  };

  return (
    <SettingsPage title="Chat & History">
      <SettingsSection title="Conversations" description="Incognito chats are never saved.">
        <Button variant="floating" onClick={onExport} disabled={!!busy} className="h-auto min-h-12 w-full justify-start whitespace-normal flex items-center gap-3 drawer-floating rounded-full px-5 py-4 hover:bg-accent text-left disabled:opacity-50">
          {busy === "export" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-muted-foreground" />}
          <div><p className="text-sm font-medium">Export chats</p></div>
        </Button>
        <Button variant="floating" onClick={() => setConfirm(true)} disabled={!!busy} className="h-auto min-h-12 w-full justify-start whitespace-normal flex items-center gap-3 rounded-full px-5 py-4 hover:bg-destructive/5 text-left disabled:opacity-50">
          <Trash2 className="w-4 h-4 text-destructive" />
          <div><p className="text-sm font-medium text-destructive">Clear all chats</p></div>
        </Button>
        {confirm && <ConfirmBox text="Delete all your chats? This can't be undone." confirmLabel="Delete all" busy={busy === "clear"} onCancel={() => setConfirm(false)} onConfirm={onClear} />}
      </SettingsSection>
    </SettingsPage>
  );
}
