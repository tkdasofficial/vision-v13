import type { ReactNode, ElementType } from "react";
import { ArrowLeft, Menu, MoreVertical } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type PageMenuItem = { label: string; icon?: ElementType; onSelect: () => void; destructive?: boolean; separatorBefore?: boolean };

/** Shared page top bar: round back/menu button left, page name centered, actions and an optional 3-dot menu right. */
export default function PageHeader({
  title, onBack, backTo, onMenu, actions, menu, className, menuClassName,
}: {
  title: ReactNode;
  onBack?: () => void;
  backTo?: string;
  onMenu?: () => void;
  actions?: ReactNode;
  menu?: PageMenuItem[];
  className?: string;
  menuClassName?: string;
}) {
  const navigate = useNavigate();
  const back = onBack ?? (backTo ? () => navigate(backTo) : onMenu ? undefined : () => navigate(-1));
  return (
    <header className={cn("grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-transparent px-4 py-3 [&_button_svg]:size-5", className)}>
      <div className="flex min-w-0 justify-start">
        {back ? (
          <Button variant="secondary" size="icon" className="size-11 shrink-0 rounded-full" aria-label="Go back" title="Go back" onClick={back}><ArrowLeft /></Button>
        ) : (
          <Button variant="secondary" size="icon" className={cn("size-11 shrink-0 rounded-full [&_svg]:size-5", menuClassName)} aria-label="Open menu" title="Open menu" onClick={onMenu}><Menu /></Button>
        )}
      </div>
      <h1 className="min-w-0 max-w-[55vw] truncate text-center font-display text-lg font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="flex min-w-0 items-center justify-end gap-2">
        {actions}
        {menu && menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="size-11 shrink-0 rounded-full" aria-label="More options" title="More options"><MoreVertical /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52 rounded-2xl p-1.5">
              {menu.map((item) => {
                const Icon = item.icon;
                return [
                  item.separatorBefore ? <DropdownMenuSeparator key={`${item.label}-sep`} /> : null,
                  <DropdownMenuItem key={item.label} onSelect={item.onSelect} className={cn("gap-3 rounded-xl px-3 py-2.5 text-[15px]", item.destructive && "text-destructive focus:text-destructive")}>
                    {Icon && <Icon className="size-[18px]" />}{item.label}
                  </DropdownMenuItem>,
                ];
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
