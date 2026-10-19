import { Github, Gitlab, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PluginDef } from "@/lib/plugins/manifest";

const Bitbucket = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
  </svg>
);

/** Brand icon for providers, extension badge for file formats — same frame everywhere. */
export default function PluginIcon({ plugin, className }: { plugin: PluginDef; className?: string }) {
  const frame = cn("flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-foreground", className);
  if (plugin.kind !== "format") {
    const Icon = plugin.provider === "github" ? Github : plugin.provider === "gitlab" ? Gitlab : plugin.provider === "bitbucket" ? Bitbucket : Globe;
    return <span className={frame}><Icon className="size-5" /></span>;
  }
  const label = plugin.name.replace(/^\./, "").slice(0, 4).toUpperCase();
  return <span className={frame}><span className={cn("font-mono font-semibold leading-none tracking-tight", label.length > 3 ? "text-[9px]" : "text-[11px]")}>{label}</span></span>;
}
