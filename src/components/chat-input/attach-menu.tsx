import { Image as ImageIcon, Clapperboard, Paperclip, AtSign } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type AttachKind = "image" | "video" | "file";

export const ACCEPT: Record<AttachKind, string> = {
  image: "image/*",
  video: "video/*,.mp4,.webm,.avi,.mov,.mkv",
  // Any file: the server-side format registry identifies it by name + content and explains unsupported ones
  // (Dockerfile, .gitignore and .env have no extension a picker filter could match).
  file: "",
};

/** "+" button opening Image / Video / File / Plugins. */
export default function AttachMenu({ onPick, onOpenPlugins, imageOnly }: { onPick: (kind: AttachKind) => void; onOpenPlugins: () => void; imageOnly?: boolean }) {
  const openingPlugins = useRef(false);
  const items = [
    { kind: "image" as const, label: "Image", icon: ImageIcon },
    ...(imageOnly ? [] : [
      { kind: "video" as const, label: "Video", icon: Clapperboard },
      { kind: "file" as const, label: "File", icon: Paperclip },
    ]),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Add attachment" title="Add attachment"
          className="size-8 shrink-0 rounded-full p-0 border border-border text-muted-foreground hover:text-foreground hover:bg-accent [&_svg]:size-[18px]">
          <Paperclip className="w-[18px] h-[18px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={10} onCloseAutoFocus={(event) => {
        if (openingPlugins.current) { event.preventDefault(); openingPlugins.current = false; }
      }} className="w-60 rounded-[1.75rem] border-border bg-card p-2 shadow-xl">
        {items.map(({ kind, label, icon: Icon }) => (
          <DropdownMenuItem key={kind} onSelect={() => onPick(kind)} className="gap-3 rounded-2xl px-2 py-2 text-[15px] font-medium">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><Icon className="size-5 text-foreground" /></span>{label}
          </DropdownMenuItem>
        ))}
        {!imageOnly && (
          <DropdownMenuItem onSelect={() => { openingPlugins.current = true; requestAnimationFrame(onOpenPlugins); }} className="gap-3 rounded-2xl px-2 py-2 text-[15px] font-medium">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><AtSign className="size-5 text-foreground" /></span>Plugins
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
