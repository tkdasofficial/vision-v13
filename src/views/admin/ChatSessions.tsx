import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { MessageSquare, Trash2, Search, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const AdminChatSessions = () => {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});

  const load = async () => {
    const [sessionsRes, profilesRes] = await Promise.all([
      supabase.from("chat_sessions").select("*").order("updated_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("id, email, full_name"),
    ]);

    const profileMap: Record<string, any> = {};
    (profilesRes.data || []).forEach((p: any) => { profileMap[p.id] = p; });

    setSessions(sessionsRes.data || []);
    setProfiles(profileMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const viewMessages = async (sessionId: string) => {
    if (expandedSession === sessionId) {
      setExpandedSession(null);
      return;
    }
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(20);
    setSessionMessages(data || []);
    setExpandedSession(sessionId);
  };

  const deleteSession = async (id: string) => {
    await supabase.from("chat_sessions").delete().eq("id", id);
    toast({ title: "Session deleted" });
    load();
  };

  const filtered = sessions.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const user = profiles[s.user_id];
    return (
      s.title?.toLowerCase().includes(q) ||
      s.preview?.toLowerCase().includes(q) ||
      user?.email?.toLowerCase().includes(q) ||
      user?.full_name?.toLowerCase().includes(q)
    );
  });

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
          <MessageSquare className="w-5 h-5 inline mr-2" />
          Chat Sessions ({filtered.length})
        </h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions..."
            className="pl-9 pr-3 py-2 rounded-full border border-border bg-background text-sm text-foreground outline-none focus:border-primary/40 transition-colors w-56"
          />
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((session) => {
          const user = profiles[session.user_id];
          const isExpanded = expandedSession === session.id;

          return (
            <div key={session.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/20 transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                    {(user?.full_name || user?.email || "?")[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{session.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email || session.user_id?.slice(0, 8)} • {new Date(session.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {session.tool_id && (
                    <span className="px-2 py-0.5 rounded-full bg-accent text-muted-foreground text-xs">{session.tool_id}</span>
                  )}
                  <button onClick={() => viewMessages(session.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" title="View messages">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteSession(session.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border bg-accent/5 px-4 py-3 space-y-2 max-h-80 overflow-y-auto">
                  {sessionMessages.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No messages</p>
                  ) : (
                    sessionMessages.map((msg: any) => (
                      <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${
                          msg.role === "user"
                            ? "bg-primary/10 text-foreground"
                            : "bg-muted text-foreground"
                        }`}>
                          <p className="text-[10px] text-muted-foreground mb-1 font-medium">{msg.role}</p>
                          <p className="whitespace-pre-wrap line-clamp-6">{msg.content || "(empty)"}</p>
                          {msg.image_url && <p className="text-primary mt-1">📎 Image attached</p>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No chat sessions found</div>
        )}
      </div>
    </div>
  );
};

export default AdminChatSessions;
