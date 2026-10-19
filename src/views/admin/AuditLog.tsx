import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { ScrollText, Loader2 } from "lucide-react";

const AdminAuditLog = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [aRes, pRes] = await Promise.all([
        supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(200),
        supabase.from("profiles").select("id, email"),
      ]);
      const map: Record<string, string> = {};
      (pRes.data || []).forEach((p: any) => { map[p.id] = p.email; });
      setItems((aRes.data || []).map((a: any) => ({ ...a, admin_email: map[a.admin_id] || a.admin_id })));
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-display font-semibold tracking-tight text-foreground flex items-center gap-2"><ScrollText className="w-5 h-5" /> Audit log</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Last 200 admin actions.</p>
      </div>
      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No audit entries yet.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-accent">
              <tr><th className="text-left p-3 font-medium text-foreground">When</th><th className="text-left p-3 font-medium text-foreground">Admin</th><th className="text-left p-3 font-medium text-foreground">Action</th><th className="text-left p-3 font-medium text-foreground">Target</th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="p-3 text-foreground text-xs truncate max-w-[160px]">{a.admin_email}</td>
                  <td className="p-3 text-foreground"><code className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">{a.action}</code></td>
                  <td className="p-3 text-muted-foreground text-xs">{a.target_type ? `${a.target_type}:${a.target_id?.slice(0, 8) || ""}` : "—"} {Object.keys(a.details || {}).length > 0 && <span className="ml-2 text-muted-foreground/70">{JSON.stringify(a.details).slice(0, 80)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminAuditLog;
