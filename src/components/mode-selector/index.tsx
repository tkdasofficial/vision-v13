import { Brain, BookOpen, Code, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CHAT_MODES, type ChatMode } from "@/lib/ai/modes";

/** Idle-state icon: the 4-cube dice look (2×2 rounded squares). */
function DiceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2.4" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2.4" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2.4" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.4" />
    </svg>
  );
}

const ICONS: Record<Exclude<ChatMode, "default">, React.ElementType> = { deep: Brain, research: BookOpen, coding: Code };
const PICKABLE = CHAT_MODES.filter((m) => m.id !== "default");

type Props = { selectedMode: ChatMode; onModeChange: (mode: ChatMode) => void };

/** Mode picker: Deep Thinking, Research, Coding. The active mode shows as a removable chip. */
export default function ModeSelector({ selectedMode, onModeChange }: Props) {
  const current = CHAT_MODES.find((m) => m.id === selectedMode);
  const active = selectedMode !== "default" && current;
  const CurrentIcon = selectedMode === "default" ? undefined : ICONS[selectedMode];

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" aria-label={active ? `Mode: ${current.label}` : "Choose mode"} title="Choose mode"
            className={cn("h-8 shrink-0 gap-1.5 rounded-full border transition-colors",
              "data-[state=open]:bg-accent data-[state=open]:text-foreground",
              active ? "border-transparent bg-secondary pl-2.5 pr-2 text-foreground hover:bg-accent [&_svg]:size-4" : "w-8 border-border p-0 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[18px]")}>
            {CurrentIcon ? <CurrentIcon className="shrink-0" /> : <DiceIcon className="shrink-0" />}
            {active && <><span className="text-[13px] font-medium leading-none">{current.label}</span><ChevronDown className="size-3.5! opacity-60" /></>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={10} className="w-64 rounded-[1.75rem] border-border bg-card p-2 shadow-xl">
          {PICKABLE.map((mode) => {
            const Icon = ICONS[mode.id];
            const selected = mode.id === selectedMode;
            return (
              <DropdownMenuItem key={mode.id} onSelect={() => onModeChange(selected ? "default" : mode.id)} className="gap-3 rounded-2xl px-2 py-2">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><Icon className="size-5 text-foreground" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-foreground">{mode.label}</span>
                  <span className="block text-xs text-muted-foreground">{mode.description}</span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
