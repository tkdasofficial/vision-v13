import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, FileText, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";
import { listDocumentsFn, deleteDocumentFn } from "@/lib/cloud/documents.functions";
import { ConfirmBox, SettingsPage, SettingsSection } from "@/components/settings/settings-ui";
import { download, exportChats } from "@/pages/settings/chat";

type Doc = { id: string; title: string; createdAt: number };

export default function PrivacyData() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => { listDocumentsFn().then(setDocs).catch(() => { setDocs([]); toast.error("Couldn't load documents."); }); }, []);

  const exportAll = async () => {
    if (!user) return; setBusy("export");
    try {
      const [{ data: profile }, { data: settings }, chats] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
        exportChats(user.id),
      ]);
      download(`vision-data-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), profile, settings, chats, documents: docs });
      toast.success("Your data was downloaded");
    } catch { toast.error("Couldn't export data."); }
    setBusy("");
  };
  const remove = async (id: string) => {
    setBusy(id);
    try { await deleteDocumentFn({ data: { id } }); setDocs((d) => (id === "all" ? [] : (d || []).filter((x) => x.id !== id))); toast.success("Deleted"); }
    catch { toast.error("Couldn't delete."); }
    setBusy(""); setConfirm("");
  };

  return (
    <SettingsPage title="Privacy & Data">
      <SettingsSection title="Your data">
        <Button variant="floating" onClick={exportAll} disabled={!!busy} className="h-auto min-h-12 w-full justify-start whitespace-normal flex items-center gap-3 drawer-floating rounded-full px-5 py-4 hover:bg-accent text-left disabled:opacity-50">
          {busy === "export" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-muted-foreground" />}
          <div><p className="text-sm font-medium">Download all my data</p></div>
        </Button>
        <p className="text-xs text-muted-foreground px-1">To delete your whole account, go to <Link to="/account" className="underline">Account</Link>.</p>
      </SettingsSection>
      <SettingsSection title="Research documents" description="Reports from Research mode. Only you can open them.">
        {docs === null ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No research documents yet.</p>
        ) : (
          <>
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 drawer-floating rounded-full px-5 py-3">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <Link to="/documents/$docId" params={{ docId: d.id }} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</p>
                </Link>
                <Button variant="floating" aria-label={`Delete ${d.title}`} onClick={() => setConfirm(d.id)} size="icon" className="size-11 shrink-0 rounded-full text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </div>
            ))}
            <Button variant="floating" onClick={() => setConfirm("all")} className="rounded-full text-sm text-destructive px-4">Delete all documents</Button>
          </>
        )}
        {confirm && <ConfirmBox text={confirm === "all" ? "Delete all research documents?" : "Delete this document?"} confirmLabel="Delete" busy={busy === confirm} onCancel={() => setConfirm("")} onConfirm={() => remove(confirm)} />}
      </SettingsSection>
    </SettingsPage>
  );
}
