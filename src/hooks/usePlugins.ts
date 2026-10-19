import { useCallback, useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { PLUGIN_BY_ID, normalizeSelection, type PluginDef } from "@/lib/plugins/manifest";

/** The signed-in user's added plugins (stored with their settings); defaults apply until they change it. */
export function usePlugins() {
  const { prefs, update, loading } = useSettings();
  const ids = useMemo(() => normalizeSelection(prefs.plugins ?? undefined), [prefs.plugins]);
  const added = useMemo(() => ids.map((i) => PLUGIN_BY_ID.get(i)!).filter(Boolean) as PluginDef[], [ids]);
  const set = useCallback((next: string[]) => update({ plugins: normalizeSelection(next) }, { quiet: true }), [update]);
  const toggle = useCallback((id: string) => set(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]), [ids, set]);
  return { ids, added, toggle, loading, isAdded: (id: string) => ids.includes(id) };
}
