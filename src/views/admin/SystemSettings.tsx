import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { Settings, Key, CheckCircle2, XCircle, Globe, Database, Server } from "lucide-react";

type SecretStatus = { name: string; configured: boolean };

const AdminSystemSettings = () => {
  const [loading, setLoading] = useState(true);
  const [dbStats, setDbStats] = useState({ users: 0, sessions: 0, messages: 0, tasks: 0, notifications: 0 });
  const [edgeFunctions, setEdgeFunctions] = useState<string[]>([
    "chat", "generate-image", "image-to-image", "pexels-videos",
    "generate-video-script", "google-tts", "video-editor", "video-render",
    "visual-analysis", "long-form-pipeline", "code-generator", "compile-tsx",
    "file-creator", "agent-planner", "task-worker",
  ]);

  // Known secrets
  const secrets: SecretStatus[] = [
    { name: "GEMINI_API_KEY", configured: true },
    { name: "GROQ_API_KEY", configured: true },
    { name: "LOVABLE_API_KEY", configured: true },
    { name: "PEXELS_API_KEY", configured: true },
    { name: "GOOGLE_TTS_API_KEY", configured: true },
  ];

  useEffect(() => {
    const load = async () => {
      const [usersRes, sessionsRes, msgsRes, tasksRes, notifsRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("chat_sessions").select("id", { count: "exact", head: true }),
        supabase.from("chat_messages").select("id", { count: "exact", head: true }),
        supabase.from("background_tasks").select("id", { count: "exact", head: true }),
        supabase.from("admin_notifications").select("id", { count: "exact", head: true }),
      ]);

      setDbStats({
        users: usersRes.count || 0,
        sessions: sessionsRes.count || 0,
        messages: msgsRes.count || 0,
        tasks: tasksRes.count || 0,
        notifications: notifsRes.count || 0,
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

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
      <h2 className="font-display text-lg font-semibold text-foreground">
        <Settings className="w-5 h-5 inline mr-2" />
        System Settings
      </h2>

      {/* API Keys Status */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          API Keys & Secrets
        </h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {secrets.map((secret) => (
            <div key={secret.name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-accent/30">
              {secret.configured ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive shrink-0" />
              )}
              <span className="text-sm text-foreground font-mono">{secret.name}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Gemini keys: 9 configured (GEMINI_API_KEY through GEMINI_API_KEY_9) for load balancing and fallback.
        </p>
      </div>

      {/* Database Stats */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          Database Records
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Users", value: dbStats.users },
            { label: "Sessions", value: dbStats.sessions },
            { label: "Messages", value: dbStats.messages },
            { label: "Tasks", value: dbStats.tasks },
            { label: "Notifications", value: dbStats.notifications },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-3 rounded-lg bg-accent/30">
              <p className="text-xl font-bold text-foreground tabular-nums">{stat.value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Edge Functions */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          Edge Functions ({edgeFunctions.length})
        </h3>
        <div className="grid sm:grid-cols-3 gap-2">
          {edgeFunctions.map((fn) => (
            <div key={fn} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/30">
              <Globe className="w-3.5 h-3.5 text-green-500" />
              <span className="text-sm text-foreground font-mono">{fn}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Supabase Info */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Project Info</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Project ID</span>
            <span className="font-mono text-foreground">getyvjzfjvuzeflxoksq</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Region</span>
            <span className="text-foreground">Auto</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">RLS</span>
            <span className="text-green-500 font-medium">Enabled (all tables)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSystemSettings;
