import { MessageSquarePlus, MoreVertical, Pencil, Pin, PinOff, ScrollText, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type ProjectMenuActions = {
  onNewChat: () => void; onTogglePin: () => void; onShare: () => void;
  onEdit: () => void; onInstructions: () => void; onDelete: () => void;
};

/** Shared clean row style for the chat/project option menus. */
const menuItemClass = "gap-3 rounded-full px-4 py-2.5 text-sm [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** Three-dot options for a project (list rows and the project page header). */
export default function ProjectMenu({ name, pinned, actions }: { name: string; pinned: boolean; actions: ProjectMenuActions }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="floating" size="icon" className="size-11 shrink-0 rounded-full" aria-label={`Options for ${name}`} title="Project options"><MoreVertical /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-60 rounded-3xl border-border/60 bg-popover/95 p-2 shadow-xl backdrop-blur-xl">
      <DropdownMenuItem className={menuItemClass} onSelect={actions.onNewChat}><MessageSquarePlus />New project chat</DropdownMenuItem>
      <DropdownMenuItem className={menuItemClass} onSelect={actions.onTogglePin}>{pinned ? <><PinOff />Unpin project</> : <><Pin />Pin project</>}</DropdownMenuItem>
      <DropdownMenuItem className={menuItemClass} onSelect={actions.onShare}><Share2 />Share project</DropdownMenuItem>
      <DropdownMenuItem className={menuItemClass} onSelect={actions.onEdit}><Pencil />Edit project</DropdownMenuItem>
      <DropdownMenuItem className={menuItemClass} onSelect={actions.onInstructions}><ScrollText />Edit instructions</DropdownMenuItem>
      <DropdownMenuSeparator className="mx-3 my-1.5" />
      <DropdownMenuItem className={`${menuItemClass} text-destructive focus:text-destructive [&_svg]:text-destructive`} onSelect={actions.onDelete}><Trash2 />Delete</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
