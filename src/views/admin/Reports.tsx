import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";

const AdminReports = () => {
  const [stats, setStats] = useState({ total: 0, free: 0, pro: 0, business: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: subs } = await supabase.from("subscriptions").select("plan");
      const all = subs || [];
      setStats({
        total: all.length,
        free: all.filter((s: any) => s.plan === "free").length,
        pro: all.filter((s: any) => s.plan === "pro").length,
        business: all.filter((s: any) => s.plan === "business").length,
      });
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const planData = [
    { label: "Free", count: stats.free, pct: stats.total ? Math.round((stats.free / stats.total) * 100) : 0 },
    { label: "Pro", count: stats.pro, pct: stats.total ? Math.round((stats.pro / stats.total) * 100) : 0 },
    { label: "Business", count: stats.business, pct: stats.total ? Math.round((stats.business / stats.total) * 100) : 0 },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl">
      <h2 className="font-display text-lg font-semibold text-foreground">Reports</h2>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Plan Distribution</h3>
        <div className="space-y-3">
          {planData.map((plan) => (
            <div key={plan.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground font-medium">{plan.label}</span>
                <span className="text-muted-foreground">{plan.count} users ({plan.pct}%)</span>
              </div>
              <div className="w-full h-2 rounded-full bg-accent overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground transition-all"
                  style={{ width: `${plan.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-2">Summary</h3>
        <p className="text-sm text-muted-foreground">
          Total registered users: {stats.total}. Active paid plans: {stats.pro + stats.business}.
          Conversion rate: {stats.total ? Math.round(((stats.pro + stats.business) / stats.total) * 100) : 0}%.
        </p>
      </div>
    </div>
  );
};

export default AdminReports;
