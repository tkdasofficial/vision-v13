import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { ToggleLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logAdminAction } from "@/lib/admin-audit";

const AdminFeatureFlags = () => {
  const { toast } = useToast();
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("feature_flags").select("*").order("key");
    setFlags(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (key: string, enabled: boolean) => {
    const { error } = await supabase.from("feature_flags").update({ enabled: !enabled, updated_at: new Date().toISOString() }).eq("key", key);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    await logAdminAction("flag_toggle", "feature_flag", key, { enabled: !enabled });
    toast({ title: `${key} → ${!enabled ? "enabled" : "disabled"}` });
    load();
  };

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-display font-semibold tracking-tight text-foreground flex items-center gap-2"><ToggleLeft className="w-5 h-5" /> Feature flags</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Toggle features for the entire platform instantly.</p>
      </div>
      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-2">
          {flags.map((f) => (
            <div key={f.key} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <code className="text-sm font-mono font-medium text-foreground">{f.key}</code>
                <p className="text-xs text-muted-foreground mt-0.5">{f.description || "—"}</p>
              </div>
              <button
                onClick={() => toggle(f.key, f.enabled)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${f.enabled ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`absolute top-0.5 ${f.enabled ? "left-[22px]" : "left-0.5"} w-5 h-5 bg-background rounded-full shadow transition-all`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminFeatureFlags;
