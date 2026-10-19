import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import PluginIcon from "@/components/plugin-icon";
import { PopoverContent } from "@/components/ui/popover";
import type { PluginDef } from "@/lib/plugins/manifest";

export default function PluginPicker({ plugins, loading, onPick, onClose }: {
  plugins: PluginDef[];
  loading: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return <PopoverContent
    aria-label="Added plugins"
    side="top" align="start" sideOffset={8} avoidCollisions={false} collisionPadding={12}
    onCloseAutoFocus={(event) => { event.preventDefault(); onClose(); }}
    className="aspect-square w-[min(24rem,calc(100vw-24px),var(--radix-popover-content-available-height))] overflow-hidden rounded-lg border-border bg-popover p-1.5 shadow-xl"
  >
    <div className="h-full overflow-y-auto overscroll-contain" aria-busy={loading}>
      {plugins.map((plugin) => <Button key={plugin.id} type="button" variant="ghost"
        aria-label={`Select ${plugin.name} plugin`} onClick={() => onPick(plugin.id)}
        className="h-auto min-h-16 w-full justify-start gap-3 whitespace-normal rounded-md px-2 py-2.5 text-left">
        <PluginIcon plugin={plugin} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">{plugin.name}</span>
          <span className="mt-0.5 block break-words text-xs font-normal leading-relaxed text-muted-foreground">{plugin.tagline}</span>
        </span>
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border"><Plus className="size-4" /></span>
      </Button>)}
      {!plugins.length && <p role="status" className="p-5 text-center text-sm text-muted-foreground">{loading ? "Loading plugins…" : "No added plugins"}</p>}
    </div>
  </PopoverContent>;
}