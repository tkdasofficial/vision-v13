import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { Zap, RefreshCw, Search, XCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  pending: { icon: Clock, color: "text-muted-foreground", label: "Pending" },
  running: { icon: Loader2, color: "text-primary", label: "Running" },
  done: { icon: CheckCircle2, color: "text-green-500", label: "Done" },
  error: { icon: XCircle, color: "text-destructive", label: "Error" },
};

const TYPE_LABELS: Record<string, string> = {
  chat: "Chat", image: "Image", code: "Code", file: "File", agent: "Agent", video: "Video",
};

const AdminBackgroundTasks = () => {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    const [tasksRes, profilesRes] = await Promise.all([
      supabase.from("background_tasks").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("id, email, full_name"),
    ]);

    const profileMap: Record<string, any> = {};
    (profilesRes.data || []).forEach((p: any) => { profileMap[p.id] = p; });

    setTasks(tasksRes.data || []);
    setProfiles(profileMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("admin-bg-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "background_tasks" }, () => {
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const cancelTask = async (id: string) => {
    await supabase.from("background_tasks").update({ status: "error", error: "Cancelled by admin" }).eq("id", id);
    toast({ title: "Task cancelled" });
    load();
  };

  const filtered = tasks.filter((t) => {
    if (filter !== "all" && t.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const user = profiles[t.user_id];
      return (
        t.task_type?.toLowerCase().includes(q) ||
        user?.email?.toLowerCase().includes(q) ||
        t.id?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    done: tasks.filter((t) => t.status === "done").length,
    error: tasks.filter((t) => t.status === "error").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          <Zap className="w-5 h-5 inline mr-2" />
          Background Tasks
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="pl-9 pr-3 py-2 rounded-full border border-border bg-background text-sm text-foreground outline-none focus:border-primary/40 transition-colors w-48"
            />
          </div>
        </div>
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "running", "done", "error"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === status
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-muted-foreground hover:text-foreground"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)} ({counts[status]})
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-border bg-accent/40">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Progress</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden lg:table-cell">Created</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => {
              const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
              const Icon = config.icon;
              const user = profiles[task.user_id];

              return (
                <tr key={task.id} className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${config.color} ${task.status === "running" ? "animate-spin" : ""}`} />
                      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full bg-accent text-foreground text-xs font-medium">
                      {TYPE_LABELS[task.task_type] || task.task_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs truncate max-w-[150px]">
                    {user?.email || task.user_id?.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">{task.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs hidden lg:table-cell">
                    {new Date(task.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {(task.status === "pending" || task.status === "running") && (
                      <button
                        onClick={() => cancelTask(task.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Cancel task"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {task.status === "error" && task.error && (
                      <span className="text-xs text-destructive truncate max-w-[120px] block" title={task.error}>
                        {task.error.slice(0, 30)}...
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No tasks found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminBackgroundTasks;
