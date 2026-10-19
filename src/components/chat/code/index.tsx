import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Download, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadText, filenameFor } from "@/lib/code-files";
import FullScreenCodeView from "@/components/chat/full-screen-code-view";
import { useCopy } from "@/components/chat/use-copy";
import { detectLanguage, highlight } from "@/components/chat/highlight";
import { codeLanguageLabel } from "@/lib/code-language-label";

type Props = { code: string; language?: string; filename?: string; children?: ReactNode; copyText?: string; copyHtml?: () => string | undefined; label?: string; regionLabel?: string };
// Content-sized canvas capped at a square that scrolls both ways. Only the Expand button opens the full-screen viewer;
// HTML/SVG preview lives in that viewer, never in the inline block.
export default function CodeBlock({ code, language, filename, children, copyText, copyHtml, label, regionLabel }: Props) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();
  const lang = useMemo(() => regionLabel ? language : detectLanguage(code, language), [code, language, regionLabel]);
  const hl = useMemo(() => highlight(code, lang), [code, lang]);
  const name = filenameFor(lang, filename);
  const format = label || codeLanguageLabel(lang);

  return (
    <div role={regionLabel ? "region" : undefined} aria-label={regionLabel} className="content-block my-3 w-full min-w-0 max-w-full">
      <div className="code-canvas content-block-frame relative flex max-h-[100cqw] flex-col overflow-hidden rounded-lg border border-border">
      <header className="content-block-header relative z-10 flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 flex-1 truncate px-2 font-mono text-xs font-medium" title={`${format} · ${name}`}>{format}</span>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label="Download code" title="Download code" onClick={() => downloadText(code, name)}><Download /></Button>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label={copied ? "Copied" : regionLabel ? `Copy ${format}` : "Copy code"} title={copied ? "Copied" : `Copy ${format}`} onClick={() => copy(copyText ?? code, copyHtml?.())}>{copied ? <Check /> : <Copy />}</Button>
        <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label="Open code full screen" title="Expand code" onClick={() => setOpen(true)}><Expand /></Button>
      </header>
      <div tabIndex={0} aria-label={`${format} content`} className="relative min-h-0 shrink overflow-auto overscroll-x-contain [touch-action:pan-x_pan-y] focus-visible:outline-2 focus-visible:outline-ring">
        <div className="content-block-body flow-root">
          {children ?? <pre className="m-0 w-max min-w-full whitespace-pre p-4"><code className="hljs bg-transparent p-0 font-mono text-[13px] leading-[1.7]" dangerouslySetInnerHTML={{ __html: hl.html }} /></pre>}
        </div>
      </div>
      <div className="content-block-footer hidden h-7 shrink-0 items-center justify-between gap-2 border-t border-border px-4 font-mono text-[11px] text-muted-foreground md:flex"><span className="truncate">{name}</span><span className="shrink-0">{code.split("\n").length} {code.includes("\n") ? "lines" : "line"}</span></div>
      </div>
      {open && <FullScreenCodeView code={code} language={lang} filename={filename} copyText={copyText} copyHtml={copyHtml} onClose={() => setOpen(false)} />}
    </div>
  );
}
