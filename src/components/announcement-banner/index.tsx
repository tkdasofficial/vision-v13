import { useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { X, Info, AlertTriangle, AlertOctagon, CheckCircle2 } from "lucide-react";

type Announcement = { id: string; title: string; body: string; level: string };

const LEVEL_STYLES: Record<string, { bg: string; icon: any }> = {
  info: { bg: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20", icon: Info },
  success: { bg: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20", icon: CheckCircle2 },
  warning: { bg: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20", icon: AlertTriangle },
  danger: { bg: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20", icon: AlertOctagon },
};

const AnnouncementBanner = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("dismissed_announcements") || "[]")); } catch { return new Set(); }
  });

  useEffect(() => {
    supabase.from("announcements").select("id, title, body, level").eq("active", true).order("created_at", { ascending: false })
      .then(({ data }) => setItems((data || []) as Announcement[]));
  }, []);

  const dismiss = (id: string) => {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    localStorage.setItem("dismissed_announcements", JSON.stringify([...next]));
  };

  const visible = items.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1.5 px-3 pt-2">
      {visible.map((a) => {
        const style = LEVEL_STYLES[a.level] || LEVEL_STYLES.info;
        const Icon = style.icon;
        return (
          <div key={a.id} className={`rounded-lg border px-3 py-2 flex items-start gap-2 text-xs ${style.bg}`}>
            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{a.title}</p>
              <p className="opacity-90">{a.body}</p>
            </div>
            <button onClick={() => dismiss(a.id)} className="p-1 rounded hover:bg-background/30 shrink-0"><X className="w-3 h-3" /></button>
          </div>
        );
      })}
    </div>
  );
};

export default AnnouncementBanner;
