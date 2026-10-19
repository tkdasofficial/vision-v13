import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Send, Trash2 } from "lucide-react";

const AdminNotifications = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("all");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("admin_notifications")
      .select("*")
      .order("created_at", { ascending: false });
    setNotifications(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const sendNotification = async () => {
    if (!title.trim() || !message.trim()) return;
    setSending(true);
    const { error } = await supabase.from("admin_notifications").insert({
      title: title.trim(),
      message: message.trim(),
      target,
      created_by: user?.id,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Notification sent" });
      setTitle("");
      setMessage("");
      load();
    }
    setSending(false);
  };

  const deleteNotification = async (id: string) => {
    await supabase.from("admin_notifications").delete().eq("id", id);
    load();
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">
      <h2 className="font-display text-lg font-semibold text-foreground">Notifications</h2>

      {/* Compose */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Send Notification</h3>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message"
          rows={3}
          className="w-full border border-border text-sm text-foreground outline-none resize-none px-4 py-3 rounded-2xl bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors"
        />
        <div className="flex items-center gap-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors"
          >
            <option value="all">All Users</option>
            <option value="free">Free Users</option>
            <option value="pro">Pro Users</option>
            <option value="business">Business Users</option>
          </select>
          <button
            onClick={sendNotification}
            disabled={sending || !title.trim() || !message.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>
      </div>

      {/* History */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Sent Notifications</h3>
        {loading ? (
          <div className="flex items-center justify-center h-20">
            <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No notifications sent yet</p>
        ) : (
          notifications.map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-card p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{n.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="px-2 py-0.5 rounded-full bg-accent text-muted-foreground text-xs">{n.target}</span>
                  <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                </div>
              </div>
              <button
                onClick={() => deleteNotification(n.id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AdminNotifications;
