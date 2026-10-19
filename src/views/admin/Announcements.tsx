import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { Megaphone, Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logAdminAction } from "@/lib/admin-audit";

const LEVELS = ["info", "success", "warning", "danger"] as const;

const AdminAnnouncements = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", body: "", level: "info", ends_at: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("announcements").insert({
      title: form.title, body: form.body, level: form.level, created_by: user?.id,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null, active: true,
    });
    setSaving(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    await logAdminAction("announcement_create", "announcement", undefined, { title: form.title, level: form.level });
    toast({ title: "Announcement published" });
    setForm({ title: "", body: "", level: "info", ends_at: "" });
    load();
  };

  const toggle = async (id: string, active: boolean) => {
    await supabase.from("announcements").update({ active: !active }).eq("id", id);
    await logAdminAction("announcement_toggle", "announcement", id, { active: !active });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    await supabase.from("announcements").delete().eq("id", id);
    await logAdminAction("announcement_delete", "announcement", id);
    load();
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-display font-semibold tracking-tight text-foreground flex items-center gap-2"><Megaphone className="w-5 h-5" /> Announcements</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Broadcast banners shown to users across the app.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 mb-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">New announcement</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="bg-background border border-border rounded-full px-4 py-2.5 text-sm" />
          <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} className="bg-background border border-border rounded-full px-4 py-2.5 text-sm">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Body" rows={3} className="border border-border text-sm sm:col-span-2 resize-none px-4 py-3 rounded-2xl bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors" />
          <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="bg-background border border-border rounded-full px-4 py-2.5 text-sm" />
          <button onClick={create} disabled={saving} className="bg-primary text-primary-foreground rounded-full px-3 py-2 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Publish
          </button>
        </div>
      </div>

      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase font-medium ${
                    a.level === "danger" ? "bg-red-500/15 text-red-600" :
                    a.level === "warning" ? "bg-amber-500/15 text-amber-600" :
                    a.level === "success" ? "bg-emerald-500/15 text-emerald-600" :
                    "bg-blue-500/15 text-blue-600"
                  }`}>{a.level}</span>
                  {!a.active && <span className="text-[10px] px-1.5 py-0.5 bg-accent text-muted-foreground rounded-full">inactive</span>}
                </div>
                <h3 className="font-medium text-sm text-foreground">{a.title}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{a.body}</p>
                <p className="text-[10px] text-muted-foreground mt-2">{new Date(a.created_at).toLocaleString()}{a.ends_at && ` · ends ${new Date(a.ends_at).toLocaleDateString()}`}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => toggle(a.id, a.active)} className="px-2 py-1 text-xs rounded-md border border-border text-foreground hover:bg-accent">{a.active ? "Pause" : "Activate"}</button>
                <button onClick={() => remove(a.id)} className="p-1.5 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No announcements yet.</div>}
        </div>
      )}
    </div>
  );
};

export default AdminAnnouncements;
