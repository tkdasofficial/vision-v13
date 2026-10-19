import { RefreshCw, CircleHelp, Plus, Check } from "lucide-react";
import { useMemo, useState } from "react";
import FloatingWorkspacePage from "@/components/floating-workspace-page";
import PluginIcon from "@/components/plugin-icon";
import { cn } from "@/lib/utils";
import { ALL_PLUGINS, GROUP_ORDER } from "@/lib/plugins/manifest";
import { usePlugins } from "@/hooks/usePlugins";

export default function Plugins() {
  const [query, setQuery] = useState("");
  const { isAdded, toggle, ids } = usePlugins();
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = ALL_PLUGINS.filter((p) => !q || `${p.name} ${p.tagline} ${p.group} ${(p.exts ?? []).join(" ")}`.toLowerCase().includes(q));
    return GROUP_ORDER.map((g) => [g, hit.filter((p) => p.group === g)] as const).filter(([, l]) => l.length);
  }, [query]);
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  return <FloatingWorkspacePage title="Plugins" query={query} onQueryChange={setQuery} menu={[{ label: "Refresh", icon: RefreshCw, onSelect: () => window.location.reload() }, { label: "Help & FAQ", icon: CircleHelp, onSelect: () => window.location.assign("/help/faq") }]}>
    <p className="mb-4 text-sm text-muted-foreground">{ALL_PLUGINS.length} plugins · {ids.length} added to chat. Type @ in a message to use them.</p>
    {groups.map(([group, list]) => <section key={group} className="mb-6" aria-label={group}>
      <h2 className="sticky top-0 z-10 mb-1 bg-background/95 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{group}</h2>
      <ul>
        {list.map((p) => {
          const on = isAdded(p.id);
          return <li key={p.id}>
            <button type="button" onClick={() => toggle(p.id)} aria-pressed={on} aria-label={`${on ? "Remove" : "Add"} ${p.name}`}
              className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-accent/60">
              <PluginIcon plugin={p} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.tagline}</span></span>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-foreground")}>
                {on ? <Check className="size-4" /> : <Plus className="size-4" />}
              </span>
            </button>
          </li>;
        })}
      </ul>
    </section>)}
    {total === 0 && <p className="py-16 text-center text-muted-foreground">No plugins found</p>}
  </FloatingWorkspacePage>;
}
