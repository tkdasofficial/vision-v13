import { Library, AtSign } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Projects is reached by swiping right-to-left on Chat, so it is not listed here.
const features = [
  { label: "Library", to: "/library", icon: Library },
  { label: "Plugins", to: "/integrations", icon: AtSign },
] as const;

export default function SidebarFeatures({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav aria-label="Workspace features" className="grid gap-2 pt-3 sm:grid-cols-2">
      {features.map(({ label, to, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Button
            key={to}
            asChild
            variant="floating"
            className={cn(
              "h-12 w-full justify-start gap-3 rounded-full px-4 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            )}
          >
            {/* Drawer pages open left→right; closing them returns to the drawer. */}
            <Link to={to} state={{ __visionDirection: "left" } as never} onClick={onNavigate} aria-current={active ? "page" : undefined}>
              <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
              <span className="truncate">{label}</span>
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
