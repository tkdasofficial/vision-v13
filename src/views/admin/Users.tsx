import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { Shield, Search, ChevronDown, ChevronUp, Eye, Ban, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logAdminAction } from "@/lib/admin-audit";

const PLAN_OPTIONS = ["free", "starter", "creator", "studio", "business"];


const AdminUsers = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("created_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userSessions, setUserSessions] = useState<any[]>([]);

  const load = async () => {
    const [profilesRes, rolesRes, subsRes] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("*"),
      supabase.from("subscriptions").select("*"),
    ]);

    const profiles = profilesRes.data || [];
    const allRoles = rolesRes.data || [];
    const subs = subsRes.data || [];

    const roleMap: Record<string, string[]> = {};
    allRoles.forEach((r: any) => {
      if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
      roleMap[r.user_id].push(r.role);
    });

    const usersWithSubs = profiles.map((p: any) => {
      const sub = subs.find((s: any) => s.user_id === p.id);
      return {
        ...p,
        plan: sub?.plan || "free",
        subStatus: sub?.status || "unknown",
        subExpires: sub?.expires_at,
      };
    });

    setUsers(usersWithSubs);
    setRoles(roleMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleAdmin = async (userId: string) => {
    const isCurrentlyAdmin = roles[userId]?.includes("admin");
    if (isCurrentlyAdmin) {
      await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", "admin");
    } else {
      await supabase.from("user_roles").insert({ user_id: userId, role: "admin" });
    }
    await logAdminAction(isCurrentlyAdmin ? "admin_remove" : "admin_grant", "user", userId);
    toast({ title: isCurrentlyAdmin ? "Admin removed" : "Admin granted" });
    load();
  };

  const toggleBan = async (userId: string, banned: boolean) => {
    await (supabase.from("profiles") as any).update({ is_banned: !banned }).eq("id", userId);
    await logAdminAction(banned ? "user_unban" : "user_ban", "user", userId);
    toast({ title: banned ? "User unbanned" : "User banned" });
    load();
  };

  const changePlan = async (userId: string, newPlan: string) => {
    const { data: existing } = await supabase.from("subscriptions").select("id").eq("user_id", userId).maybeSingle();
    if (existing) {
      await supabase.from("subscriptions").update({ plan: newPlan, status: "active", updated_at: new Date().toISOString() }).eq("user_id", userId);
    } else {
      await supabase.from("subscriptions").insert({ user_id: userId, plan: newPlan, status: "active" });
    }
    await logAdminAction("plan_change", "user", userId, { plan: newPlan });
    toast({ title: `Plan changed to ${newPlan}` });
    load();
  };


  const viewUserSessions = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    const { data } = await supabase
      .from("chat_sessions")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5);
    setUserSessions(data || []);
    setExpandedUser(userId);
  };

  // Filter and sort
  const filtered = users
    .filter((u) => {
      if (search) {
        const q = search.toLowerCase();
        if (!(u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q))) return false;
      }
      if (filterPlan !== "all" && u.plan !== filterPlan) return false;
      if (filterRole === "admin" && !roles[u.id]?.includes("admin")) return false;
      if (filterRole === "user" && roles[u.id]?.includes("admin")) return false;
      return true;
    })
    .sort((a, b) => {
      const va = a[sortField] || "";
      const vb = b[sortField] || "";
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

  const toggleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
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
        <h2 className="font-display text-lg font-semibold text-foreground">Users ({filtered.length})</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="pl-9 pr-3 py-2 rounded-full border border-border bg-background text-sm text-foreground outline-none focus:border-primary/40 transition-colors w-48"
            />
          </div>
          <select value={filterPlan} onChange={(e) => setFilterPlan(e.target.value)} className="border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors">
            <option value="all">All Plans</option>
            {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} className="border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors">
            <option value="all">All Roles</option>
            <option value="admin">Admins</option>
            <option value="user">Users</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-border bg-accent/40">
              <th onClick={() => toggleSort("full_name")} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                <span className="flex items-center gap-1">Name <SortIcon field="full_name" /></span>
              </th>
              <th onClick={() => toggleSort("email")} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground">
                <span className="flex items-center gap-1">Email <SortIcon field="email" /></span>
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Plan</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Role</th>
              <th onClick={() => toggleSort("created_at")} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground hidden lg:table-cell">
                <span className="flex items-center gap-1">Joined <SortIcon field="created_at" /></span>
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => (
              <>
                <tr key={user.id} className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                        {(user.full_name || user.email || "?")[0]?.toUpperCase()}
                      </div>
                      <span className="text-foreground font-medium truncate max-w-[120px]">{user.full_name || "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[180px]">{user.email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={user.plan}
                      onChange={(e) => changePlan(user.id, e.target.value)}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium border-none outline-none cursor-pointer ${
                        user.plan !== "free" ? "bg-primary/10 text-primary" : "bg-accent text-muted-foreground"
                      }`}
                    >
                      {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      {roles[user.id]?.includes("admin") && (
                        <span className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-xs font-medium">admin</span>
                      )}
                      {user.is_banned && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 text-xs font-medium">banned</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs hidden lg:table-cell">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => viewUserSessions(user.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="View sessions"
                      ><Eye className="w-4 h-4" /></button>
                      <button
                        onClick={() => toggleAdmin(user.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title={roles[user.id]?.includes("admin") ? "Remove admin" : "Make admin"}
                      ><Shield className="w-4 h-4" /></button>
                      <button
                        onClick={() => toggleBan(user.id, !!user.is_banned)}
                        className={`p-1.5 rounded-lg hover:bg-accent transition-colors ${user.is_banned ? "text-emerald-600" : "text-muted-foreground hover:text-amber-600"}`}
                        title={user.is_banned ? "Unban" : "Ban"}
                      >{user.is_banned ? <UserCheck className="w-4 h-4" /> : <Ban className="w-4 h-4" />}</button>
                    </div>
                  </td>
                </tr>

                {expandedUser === user.id && (
                  <tr key={`${user.id}-detail`} className="bg-accent/10">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-foreground">User ID: <span className="font-mono text-muted-foreground">{user.id}</span></p>
                        <p className="text-xs font-medium text-foreground">Subscription: <span className="text-muted-foreground">{user.subStatus} (expires: {user.subExpires ? new Date(user.subExpires).toLocaleDateString() : "never"})</span></p>
                        <p className="text-xs font-medium text-foreground">Recent Sessions:</p>
                        {userSessions.length > 0 ? (
                          <div className="space-y-1 pl-2">
                            {userSessions.map((s: any) => (
                              <p key={s.id} className="text-xs text-muted-foreground">
                                • {s.title || "Untitled"} — {new Date(s.updated_at).toLocaleString()}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground pl-2">No sessions</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminUsers;
