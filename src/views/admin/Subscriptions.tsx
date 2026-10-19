import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Search, Loader2, Calendar } from "lucide-react";
import { logAdminAction } from "@/lib/admin-audit";

const STATUS = ["active", "cancelled", "past_due", "trial"];

const AdminSubscriptions = () => {
  const { toast } = useToast();
  const [subs, setSubs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");

  const load = async () => {
    const [subsRes, profRes, planRes] = await Promise.all([
      supabase.from("subscriptions").select("*").order("updated_at", { ascending: false }),
      supabase.from("profiles").select("id, email, full_name"),
      supabase.from("plan_limits").select("plan, display_name, price_monthly").order("sort_order"),
    ]);
    const map: Record<string, any> = {};
    (profRes.data || []).forEach((p: any) => { map[p.id] = p; });
    setSubs((subsRes.data || []).map((s: any) => ({ ...s, email: map[s.user_id]?.email || "—", name: map[s.user_id]?.full_name || "—" })));
    setPlans(planRes.data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateField = async (subId: string, field: string, value: any, userId: string) => {
    const { error } = await supabase.from("subscriptions").update({ [field]: value, updated_at: new Date().toISOString() } as any).eq("id", subId);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    await logAdminAction("subscription_update", "subscription", subId, { user_id: userId, [field]: value });
    toast({ title: `Updated ${field}` });
    load();
  };

  const extend = async (sub: any, days: number) => {
    const base = sub.expires_at ? new Date(sub.expires_at) : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + days);
    await updateField(sub.id, "expires_at", base.toISOString(), sub.user_id);
  };

  const filtered = subs.filter((s) => {
    if (planFilter !== "all" && s.plan !== planFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (s.email || "").toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q);
  });

  const totals = subs.reduce((acc: any, s: any) => { acc[s.plan] = (acc[s.plan] || 0) + 1; return acc; }, {});
  const mrr = plans.reduce((acc, p) => acc + (totals[p.plan] || 0) * Number(p.price_monthly), 0);

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-foreground flex items-center gap-2"><CreditCard className="w-5 h-5" /> Subscriptions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manually manage user plans, status and expiry.</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mock MRR</p>
          <p className="text-lg font-bold text-foreground">${mrr.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {plans.map((p) => (
          <div key={p.plan} className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.display_name}</p>
            <p className="text-lg font-bold text-foreground">{totals[p.plan] || 0}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email / name..." className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="bg-card border border-border rounded-full px-4 py-2.5 text-sm">
          <option value="all">All plans</option>
          {plans.map((p) => <option key={p.plan} value={p.plan}>{p.display_name}</option>)}
        </select>
      </div>

      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-accent">
              <tr>
                <th className="text-left p-3 font-medium">User</th>
                <th className="text-left p-3 font-medium">Plan</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Cycle</th>
                <th className="text-left p-3 font-medium">Expires</th>
                <th className="text-right p-3 font-medium">Quick extend</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-t border-border align-top">
                  <td className="p-3">
                    <p className="font-medium text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.email}</p>
                  </td>
                  <td className="p-3">
                    <select value={s.plan} onChange={(e) => updateField(s.id, "plan", e.target.value, s.user_id)} className="bg-background border border-border rounded-md px-2 py-1 text-xs">
                      {plans.map((p) => <option key={p.plan} value={p.plan}>{p.display_name}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    <select value={s.status} onChange={(e) => updateField(s.id, "status", e.target.value, s.user_id)} className="bg-background border border-border rounded-md px-2 py-1 text-xs">
                      {STATUS.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    <select value={s.billing_cycle || "monthly"} onChange={(e) => updateField(s.id, "billing_cycle", e.target.value, s.user_id)} className="bg-background border border-border rounded-md px-2 py-1 text-xs">
                      <option value="monthly">monthly</option>
                      <option value="yearly">yearly</option>
                    </select>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                    <Calendar className="w-3 h-3 inline mr-1" />
                    {s.expires_at ? new Date(s.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <button onClick={() => extend(s, 7)} className="text-xs px-2 py-1 border border-border rounded-md hover:bg-accent">+7d</button>
                    <button onClick={() => extend(s, 30)} className="text-xs px-2 py-1 border border-border rounded-md hover:bg-accent ml-1">+30d</button>
                    <button onClick={() => extend(s, 365)} className="text-xs px-2 py-1 border border-border rounded-md hover:bg-accent ml-1">+1y</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">No subscriptions match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminSubscriptions;
