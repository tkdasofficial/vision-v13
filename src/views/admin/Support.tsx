import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { LifeBuoy, Loader2, Send, CheckCircle2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logAdminAction } from "@/lib/admin-audit";

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  priority: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
  replied_at: string | null;
  email?: string;
};

const AdminSupport = () => {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all" | "resolved">("open");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [tRes, pRes] = await Promise.all([
      supabase.from("support_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, email"),
    ]);
    const map: Record<string, string> = {};
    (pRes.data || []).forEach((p: any) => { map[p.id] = p.email; });
    setTickets((tRes.data || []).map((t: any) => ({ ...t, email: map[t.user_id] || "—" })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = tickets.filter((t) => filter === "all" ? true : t.status === filter);

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("support_tickets").update({
      admin_reply: reply, status: "resolved", replied_by: user?.id, replied_at: new Date().toISOString(),
    }).eq("id", selected.id);
    setSaving(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    await logAdminAction("ticket_reply", "support_ticket", selected.id, { subject: selected.subject });
    toast({ title: "Reply sent" });
    setReply(""); setSelected(null); load();
  };

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-foreground flex items-center gap-2"><LifeBuoy className="w-5 h-5" /> Support inbox</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Reply to user tickets and feedback.</p>
        </div>
        <div className="flex gap-1 p-1 bg-accent rounded-lg">
          {(["open","all","resolved"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 text-xs rounded-md transition-colors ${filter === f ? "bg-background text-foreground" : "text-muted-foreground"}`}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="py-20 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> :
        filtered.length === 0 ? <div className="py-20 text-center text-sm text-muted-foreground">No tickets in this view.</div> : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${t.status === "open" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>
                      {t.status === "open" ? <Clock className="w-3 h-3 inline mr-0.5" /> : <CheckCircle2 className="w-3 h-3 inline mr-0.5" />}{t.status}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-accent text-foreground rounded-full font-medium uppercase tracking-wide">{t.priority}</span>
                    <span className="text-xs text-muted-foreground truncate">{t.email}</span>
                  </div>
                  <h3 className="font-medium text-foreground text-sm">{t.subject}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{t.message}</p>
                  {t.admin_reply && <p className="text-sm text-foreground mt-2 p-2 bg-accent rounded-md border-l-2 border-primary"><span className="text-[10px] uppercase text-muted-foreground">Admin reply</span><br />{t.admin_reply}</p>}
                </div>
                {t.status === "open" && (
                  <button onClick={() => setSelected(t)} className="shrink-0 px-3 py-1.5 text-xs bg-foreground text-background rounded-full font-medium hover:opacity-90">Reply</button>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">{new Date(t.created_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
          <div className="bg-card rounded-2xl border border-border w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display font-semibold text-foreground">Reply to ticket</h2>
            <p className="text-xs text-muted-foreground mt-1 mb-3">{selected.subject} · {selected.email}</p>
            <div className="text-sm p-3 rounded-lg bg-accent text-foreground mb-3 max-h-32 overflow-y-auto">{selected.message}</div>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type your reply..." rows={5} className="w-full bg-background border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setSelected(null)} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={sendReply} disabled={saving || !reply.trim()} className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-full font-medium disabled:opacity-60 flex items-center gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send & resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSupport;
