import { useState } from "react";
import { FileText, FileImage, FileVideo, FileAudio, FileArchive, Paperclip } from "lucide-react";
import type { ChatMessage, MessageAttachment, PastedBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

// About twice what fits in three lines of a phone-width bubble before "Show More".
const TEXT_LIMIT = 170;
export const PASTE_CARD_LINES = 50;

export const lineCount = (t: string) => t.replace(/\n+$/, "").split("\n").length;
export function pastedTitle(text: string) {
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "Pasted text";
  return first.replace(/^#+\s*/, "").replace(/[*_`>]/g, "").slice(0, 80) || "Pasted text";
}

const ext = (name: string) => (name.split(".").pop() ?? "").toUpperCase();
function iconFor(a: MessageAttachment) {
  if (a.kind === "image") return FileImage;
  if (a.kind === "video") return FileVideo;
  if (a.kind === "audio") return FileAudio;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(a.name)) return FileArchive;
  return FileText;
}

/** Round paperclip badge sitting on the top-right corner of an attachment (same look as the input's attach button). */
export const ClipBadge = () => (
  <span aria-hidden className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm">
    <Paperclip className="size-4" />
  </span>
);

/** File chip: icon box, name, type. Height is shared with image tiles. */
export function FileChip({ name, kind, mime, children }: MessageAttachment & { children?: React.ReactNode }) {
  const Icon = iconFor({ name, kind, mime });
  return (
    <div className="relative flex h-[72px] min-w-0 max-w-[260px] items-center gap-3 rounded-2xl border border-border bg-card pl-3 pr-5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary"><Icon className="size-5 text-muted-foreground" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-medium text-foreground">{name}</span>
        <span className="block text-xs text-muted-foreground">{ext(name) || (kind === "file" ? "File" : kind[0].toUpperCase() + kind.slice(1))}</span>
      </span>
      {children}
    </div>
  );
}

/** Square image tile, same height as a file chip. */
export function ImageTile({ src, alt, children }: { src: string; alt: string; children?: React.ReactNode }) {
  return (
    <div className="relative size-[72px] shrink-0">
      <img src={src} alt={alt} className="size-full rounded-2xl border border-border object-cover" />
      {children}
    </div>
  );
}

/** Long pasted prompt shown as a full-width card with a Markdown · N lines header. */
export function PastedCard({ block }: { block: PastedBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full rounded-3xl border border-border bg-card px-5 pb-4 pt-4 text-foreground">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-[15px] font-semibold">{block.title}</span>
        <span className="shrink-0 text-sm text-muted-foreground">Markdown · {block.lines} lines</span>
        <Paperclip className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className={cn("mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed", !open && "line-clamp-4")}>{block.text}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        {open ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function TextBubble({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > TEXT_LIMIT;
  const shown = long && !open ? text.slice(0, TEXT_LIMIT).trimEnd() + "…" : text;
  return (
    <div className="max-w-[85%] min-w-0 rounded-3xl border border-border bg-card px-4 py-3 text-[15px] text-foreground">
      <p className="whitespace-pre-wrap break-words leading-relaxed">{shown}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          {open ? "Show Less" : "Show More"}
        </button>
      )}
    </div>
  );
}

/** Everything the user sent: attachments (chips / square images), pasted prompt cards, then their text. */
export default function UserMessage({ message }: { message: ChatMessage }) {
  // Older saved messages without card info: a 50+ line message is still shown as a pasted card.
  const legacyPaste = !message.pasted && message.typed === undefined && !message.attachments && lineCount(message.content || "") >= PASTE_CARD_LINES;
  const pasted = message.pasted ?? (legacyPaste ? [{ title: pastedTitle(message.content), lines: lineCount(message.content), text: message.content }] : []);
  const text = (legacyPaste ? "" : message.pasted || message.typed !== undefined ? message.typed ?? "" : message.content || "").trim();
  const files = message.attachments ?? [];
  return (
    <div className="flex w-full flex-col items-end gap-2">
      {(message.imageUrl || files.length > 0) && (
        <div className="flex max-w-full flex-wrap justify-end gap-3 pr-2 pt-2">
          {message.imageUrl && <ImageTile src={message.imageUrl} alt="Attached image"><ClipBadge /></ImageTile>}
          {files.map((f, i) => <FileChip key={`${f.name}-${i}`} {...f}><ClipBadge /></FileChip>)}
        </div>
      )}
      {pasted.map((b, i) => <PastedCard key={i} block={b} />)}
      {text && <TextBubble text={text} />}
    </div>
  );
}
