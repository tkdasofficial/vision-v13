import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { applyPrefs, cachePrefs, parsePrefs, readCachedPrefs, type Prefs } from "@/lib/settings";

/** Loads the signed-in user's preferences from user_settings and saves changes back. */
export function useSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(() => readCachedPrefs());
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase.from("user_settings").select("prefs, language").eq("user_id", user.id).maybeSingle();
      if (error) toast.error("Couldn't load your settings.");
      else if (!data) await supabase.from("user_settings").insert({ user_id: user.id });
      else {
        const p = parsePrefs((data as any).prefs);
        setPrefs(p); cachePrefs(p); applyPrefs(p);
        setLanguage((data as any).language || "en");
      }
      setLoading(false);
    })();
  }, [user]);

  // Keeps every mounted settings user (Plugins page, chat composer) in sync after a save.
  useEffect(() => {
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener("vision:prefs", on);
    return () => window.removeEventListener("vision:prefs", on);
  }, []);

  /** Saves a patch; returns true only after the server confirms. */
  const update = useCallback(async (patch: Partial<Prefs>, opts: { quiet?: boolean } = {}) => {
    if (!user) return false;
    const prev = prefs;
    const next = parsePrefs({ ...prefs, ...patch });
    setPrefs(next); applyPrefs(next);
    setSaving(true);
    let error: unknown = null;
    let confirmed = next;
    if (Object.keys(patch).every((key) => key === "savedMemories" || key === "chatHistory")) {
      try {
        const res = await fetch("/api/memories", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ switches: patch }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't save memory settings.");
        confirmed = parsePrefs(data.prefs);
        setPrefs(confirmed); applyPrefs(confirmed);
      } catch (e) { error = e; }
    } else {
      const result = await supabase.from("user_settings")
        .update({ prefs: JSON.stringify(next), updated_at: new Date().toISOString() }).eq("user_id", user.id);
      error = result.error;
    }
    setSaving(false);
    if (error) { setPrefs(prev); applyPrefs(prev); toast.error("Couldn't save. Please try again."); return false; }
    cachePrefs(confirmed);
    window.dispatchEvent(new CustomEvent("vision:prefs", { detail: confirmed }));
    if (!opts.quiet) toast.success("Saved");
    return true;
  }, [user, prefs]);

  const updateLanguage = useCallback(async (lang: string) => {
    if (!user) return;
    const { error } = await supabase.from("user_settings").update({ language: lang }).eq("user_id", user.id);
    if (error) toast.error("Couldn't save."); else { setLanguage(lang); toast.success("Saved"); }
  }, [user]);

  return { prefs, update, language, updateLanguage, loading, saving };
}
