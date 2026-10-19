import { useMemo } from "react";
import { highlight } from "@/components/chat/highlight";
import { cn } from "@/lib/utils";

export default function CodeSource({ code, language, wrap = false, lineNumbers = true, query = "", activeLine, size = 13 }: {
  code: string; language?: string; wrap?: boolean; lineNumbers?: boolean; query?: string; activeLine?: number; size?: number;
}) {
  const lines = useMemo(() => code.split("\n"), [code]);
  return <div className="code-canvas min-h-full min-w-full font-mono leading-relaxed" style={{ fontSize: size }}>
    <div className={cn("py-3", !wrap && "min-w-max")}>
      {lines.map((line, index) => <div key={index} data-code-line={index + 1} className={cn("flex min-h-[1.6em]", query && line.toLowerCase().includes(query.toLowerCase()) && "bg-accent/60", activeLine === index + 1 && "bg-primary/10 ring-1 ring-inset ring-ring/30")}>
        {lineNumbers && <span aria-hidden="true" className="sticky left-0 z-[1] w-14 shrink-0 select-none border-r border-border bg-muted px-3 text-right text-muted-foreground">{index + 1}</span>}
        <code className={cn("hljs block min-w-0 flex-1 bg-transparent px-4", wrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "whitespace-pre")} dangerouslySetInnerHTML={{ __html: highlight(line, language).html || "\n" }} />
      </div>)}
    </div>
  </div>;
}