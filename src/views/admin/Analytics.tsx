import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { TrendingUp, Users, MessageSquare, Zap, Calendar } from "lucide-react";

const COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground))", "hsl(var(--accent-foreground))", "#10b981"];

const AdminAnalytics = () => {
  const [loading, setLoading] = useState(true);
  const [usersByDay, setUsersByDay] = useState<any[]>([]);
  const [sessionsByDay, setSessionsByDay] = useState<any[]>([]);
  const [tasksByType, setTasksByType] = useState<any[]>([]);
  const [planData, setPlanData] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState<number>(7);
  const [totals, setTotals] = useState({ users: 0, sessions: 0, messages: 0, tasks: 0 });

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const [profilesRes, sessionsRes, subsRes, tasksRes, msgsRes] = await Promise.all([
        supabase.from("profiles").select("created_at"),
        supabase.from("chat_sessions").select("created_at"),
        supabase.from("subscriptions").select("plan"),
        supabase.from("background_tasks").select("task_type, created_at, status"),
        supabase.from("chat_messages").select("id", { count: "exact", head: true }),
      ]);

      const profiles = profilesRes.data || [];
      const sessions = sessionsRes.data || [];
      const subs = subsRes.data || [];
      const tasks = tasksRes.data || [];

      setTotals({
        users: profiles.length,
        sessions: sessions.length,
        messages: msgsRes.count || 0,
        tasks: tasks.length,
      });

      // Users by day
      const now = new Date();
      const days: any[] = [];
      const sessionDays: any[] = [];
      for (let i = timeRange - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dayStr = date.toLocaleDateString("en", { month: "short", day: "numeric" });
        const dateStr = date.toDateString();

        days.push({
          day: dayStr,
          users: profiles.filter((p: any) => new Date(p.created_at).toDateString() === dateStr).length,
        });
        sessionDays.push({
          day: dayStr,
          sessions: sessions.filter((s: any) => new Date(s.created_at).toDateString() === dateStr).length,
        });
      }
      setUsersByDay(days);
      setSessionsByDay(sessionDays);

      // Tasks by type
      const typeMap: Record<string, number> = {};
      tasks.forEach((t: any) => {
        typeMap[t.task_type] = (typeMap[t.task_type] || 0) + 1;
      });
      setTasksByType(Object.entries(typeMap).map(([name, value]) => ({ name, value })));

      // Plan distribution
      const planMap: Record<string, number> = {};
      subs.forEach((s: any) => {
        planMap[s.plan] = (planMap[s.plan] || 0) + 1;
      });
      setPlanData(Object.entries(planMap).map(([name, value]) => ({ name, value })));

      setLoading(false);
    };
    load();
  }, [timeRange]);

  const chartStyle = {
    contentStyle: {
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "8px",
      fontSize: "12px",
    },
    labelStyle: { color: "hsl(var(--foreground))" },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          <TrendingUp className="w-5 h-5 inline mr-2" />
          Analytics
        </h2>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              onClick={() => setTimeRange(days)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                timeRange === days ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Users", value: totals.users, icon: Users },
          { label: "Chat Sessions", value: totals.sessions, icon: MessageSquare },
          { label: "Messages", value: totals.messages, icon: MessageSquare },
          { label: "Background Tasks", value: totals.tasks, icon: Zap },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-border px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground tabular-nums">{card.value.toLocaleString()}</p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* User Growth */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">User Signups</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={usersByDay}>
              <defs>
                <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...chartStyle} />
              <Area type="monotone" dataKey="users" stroke="hsl(var(--primary))" fill="url(#gradUsers)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Session Activity */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Chat Sessions</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sessionsByDay}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...chartStyle} />
              <Bar dataKey="sessions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tasks by Type */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Tasks by Type</h3>
          {tasksByType.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={tasksByType} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                    {tasksByType.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...chartStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-3 mt-2 flex-wrap">
                {tasksByType.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">No tasks yet</div>
          )}
        </div>

        {/* Plan Distribution */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Plan Distribution</h3>
          {planData.length > 0 ? (
            <div className="space-y-3">
              {planData.map((plan, i) => {
                const total = planData.reduce((sum, p) => sum + p.value, 0);
                const pct = total ? Math.round((plan.value / total) * 100) : 0;
                return (
                  <div key={plan.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground font-medium capitalize">{plan.name}</span>
                      <span className="text-muted-foreground">{plan.value} ({pct}%)</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">No data</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;
