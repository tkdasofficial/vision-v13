import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Code2, Columns2, Copy, Download, Eye, ListOrdered, Search, WrapText, X } from "lucide-react";
import { Dialog, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { downloadText, filenameFor } from "@/lib/code-files";
import { useCopy } from "@/components/chat/use-copy";
import CodeSource from "@/components/chat/code-source";
import PreviewPane from "@/components/chat/preview-pane";
import { cn } from "@/lib/utils";
import { ZoomControls, usePinchZoom } from "@/components/chat/zoom-controls";
import { codeLanguageLabel } from "@/lib/code-language-label";

type Props = { code: string; language?: string; filename?: string; html?: string; previewHTML?: string; iframeRef?: Ref<HTMLIFrameElement>; initialView?: "code" | "preview" | "split"; copyText?: string; copyHtml?: () => string | undefined; markdownBody?: ReactNode; onClose: () => void };
const MIN = 8, MAX = 32, BASE = 13;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

export default function FullScreenCodeView({ code, language, filename, previewHTML, iframeRef, initialView = "code", copyText, copyHtml, markdownBody, onClose }: Props) {
  const { copied, copy } = useCopy();
  const name = filenameFor(language, filename);
  const [size, setSize] = useState(BASE);
  const [wrap, setWrap] = useState(false);
  const [numbers, setNumbers] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [view, setView] = useState(initialView);
  const area = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const preview = markdownBody ? undefined : previewHTML ?? (["html", "htm", "svg"].includes(language ?? "") ? code : undefined);
  const matches = useMemo(() => query ? code.split("\n").flatMap((line, index) => line.toLowerCase().includes(query.toLowerCase()) ? [index + 1] : []) : [], [code, query]);
  const activeLine = matches[matchIndex % (matches.length || 1)];

  usePinchZoom(area, () => size, (value) => setSize(clamp(Math.round(value))), 1);
  useEffect(() => { area.current?.querySelector(`[data-code-line="${activeLine}"]`)?.scrollIntoView({ block: "center", inline: "nearest" }); }, [activeLine]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  const moveMatch = (direction: number) => setMatchIndex((index) => (index + direction + matches.length) % (matches.length || 1));

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogPortal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[9999] bg-background" />
    <DialogPrimitive.Content aria-describedby={undefined} className="code-canvas code-viewer fixed inset-0 z-[10000] flex h-dvh min-w-0 flex-col text-foreground outline-none pb-[env(safe-area-inset-bottom)] md:pt-[env(safe-area-inset-top)]" onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setView(view === "preview" ? "code" : view); setSearchOpen(true); }
    }}>
      <header className="code-viewer-header absolute inset-x-0 top-0 z-10 grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-1 px-2 pb-4 pt-[max(8px,env(safe-area-inset-top))] md:static md:flex md:min-h-14 md:shrink-0 md:items-center md:border-b md:border-border md:py-1">
        <Button variant="ghost" size="icon" className="code-viewer-action shrink-0 rounded-full md:rounded-md" onClick={onClose} aria-label="Back" title="Back to chat"><ArrowLeft /></Button>
        <DialogTitle aria-label={name} title={name} className="min-w-0 truncate px-1 pt-2.5 font-mono text-sm font-medium md:flex-1 md:pt-0">{codeLanguageLabel(language)}</DialogTitle>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" className={cn("code-viewer-action rounded-full md:hidden", !preview && "hidden")} disabled={!preview} aria-label={view === "preview" ? "Show code" : "Preview"} title={view === "preview" ? "Show code" : "Preview"} aria-pressed={view === "preview"} onClick={() => setView(view === "preview" ? "code" : "preview")}>{view === "preview" ? <Code2 /> : <Eye />}</Button>
          <Button variant="ghost" size="icon" className="code-viewer-action rounded-full md:rounded-md" onClick={() => downloadText(code, name)} aria-label={`Download ${name}`} title="Download file"><Download /></Button>
          <Button variant="ghost" size="icon" className="code-viewer-action rounded-full md:rounded-md" onClick={() => copy(copyText ?? code, copyHtml?.())} aria-label={copied ? "Copied" : "Copy"} title={copied ? "Copied" : "Copy code"}>{copied ? <Check /> : <Copy />}</Button>
        </div>
      </header>
      {!markdownBody && <div className="hidden shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border bg-muted/30 px-2 py-1.5 md:flex">
        <div className="flex items-center gap-1" aria-label="Code view layout">{([{ value: "code", Icon: Code2 }, { value: "preview", Icon: Eye }, { value: "split", Icon: Columns2 }] as const).map(({ value, Icon }) => <Button key={value} variant="ghost" size="icon" className={cn("size-8 rounded-md", view === value && "bg-accent")} disabled={value !== "code" && !preview} aria-label={`${value} view`} title={`${value} view`} aria-pressed={view === value} onClick={() => setView(value)}><Icon /></Button>)}</div>
        {view !== "preview" && <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8 rounded-md" aria-label="Find in code" title="Find in code" aria-pressed={searchOpen} onClick={() => setSearchOpen((open) => !open)}><Search /></Button>
          <Button variant="ghost" size="icon" className={cn("size-8 rounded-md", wrap && "bg-accent")} aria-label="Wrap lines" title="Wrap lines" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}><WrapText /></Button>
          <Button variant="ghost" size="icon" className={cn("size-8 rounded-md", numbers && "bg-accent")} aria-label="Line numbers" title="Line numbers" aria-pressed={numbers} onClick={() => setNumbers((value) => !value)}><ListOrdered /></Button>
        </div>}
      </div>}
      {searchOpen && !markdownBody && view !== "preview" && <div className="hidden shrink-0 items-center gap-1 border-b border-border px-3 py-2 md:flex">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input ref={searchInput} aria-label="Search code" placeholder="Find in code…" value={query} onChange={(e) => { setQuery(e.target.value); setMatchIndex(0); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); moveMatch(e.shiftKey ? -1 : 1); } }} className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <span role="status" className="shrink-0 text-xs text-muted-foreground">{query ? matches.length ? `${matchIndex % matches.length + 1} / ${matches.length} lines` : "No matches" : ""}</span>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Previous match" title="Previous match" disabled={!matches.length} onClick={() => moveMatch(-1)}><ChevronUp /></Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Next match" title="Next match" disabled={!matches.length} onClick={() => moveMatch(1)}><ChevronDown /></Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Close search" title="Close search" onClick={() => { setSearchOpen(false); setQuery(""); }}><X /></Button>
      </div>}
      <div className={cn("grid min-h-0 flex-1 pt-[max(64px,calc(env(safe-area-inset-top)+56px))] md:pt-0", view === "split" ? "grid-rows-2 md:grid-cols-2 md:grid-rows-1" : "grid-cols-1")}>
        {view !== "preview" && <div className="relative min-h-0 min-w-0"><ZoomControls className="absolute bottom-3 right-3 z-10 rounded-full border border-border bg-background/90 p-0.5 shadow-md backdrop-blur" percent={Math.round(size / BASE * 100)} canOut={size > MIN} canIn={size < MAX} onOut={() => setSize((s) => clamp(s - 1))} onIn={() => setSize((s) => clamp(s + 1))} onReset={() => setSize(BASE)} /><div ref={area} aria-label="Code content" tabIndex={0} className="mobile-code-source h-full min-h-0 min-w-0 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">{markdownBody ? <div aria-label="Markdown text" className="w-max min-w-full p-5 pb-16 leading-relaxed text-foreground [&_*]:whitespace-pre" style={{ fontSize: size + 1 }}>{markdownBody}</div> : <CodeSource code={code} language={language} size={size} wrap={wrap} lineNumbers={numbers} query={query} activeLine={activeLine} />}</div></div>}
        {view !== "code" && preview && <div className="min-h-0 min-w-0 border-t border-border md:border-l md:border-t-0"><PreviewPane html={preview} iframeRef={iframeRef} title={`${name} preview`} /></div>}
      </div>
       <footer className="hidden h-8 shrink-0 items-center justify-between gap-2 border-t border-border px-3 font-mono text-[11px] text-muted-foreground md:flex"><span className="truncate">{language || "Plain text"} · {code.split("\n").length} lines</span><span className="shrink-0">{new TextEncoder().encode(code).length.toLocaleString()} bytes</span></footer>
    </DialogPrimitive.Content>
  </DialogPortal></Dialog>;
}
