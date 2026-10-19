import { Children, isValidElement, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { normalizeMath } from "@/lib/math";
import { Check, Copy, Download, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import FullScreenCodeView from "@/components/chat/full-screen-code-view";
import { useCopy } from "@/components/chat/use-copy";
import { downloadText } from "@/lib/code-files";
import { markdownToPlainText } from "@/lib/markdown-plain";

import { Callout, FlowDiagram, remarkCallouts, CALLOUT_TYPES, type CalloutType } from "@/components/chat/rich-blocks";

type Props = { markdown: string; label?: string; renderCode?: (code: string, language: string) => ReactNode };

/** Markdown copy box: rendered text only (no raw markers), every source line on its own line.
 *  Scrolls both ways inline; only Expand opens the full-screen viewer, where lines never wrap. */
export default function MarkdownBlock({ markdown, label = "Markdown", renderCode }: Props) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();
  const body = useRef<HTMLDivElement>(null);
  const plain = markdownToPlainText(markdown);
  const copyHtml = () => body.current?.innerHTML;
  const components: Components = {
    pre: ({ children }) => {
      const child = Children.toArray(children).find(isValidElement);
      if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return <pre>{children}</pre>;
      const lang = (child.props.className ?? "").replace(/^language-/, "").toLowerCase();
      const source = String(child.props.children ?? "").replace(/\n$/, "");
      if (["flow", "steps", "pipeline"].includes(lang)) return <FlowDiagram source={source} />;
      return renderCode ? <>{renderCode(source, lang)}</> : <pre>{children}</pre>;
    },
    blockquote: ({ children, node }) => {
      const type = String(node?.properties?.dataCallout ?? node?.properties?.["data-callout"] ?? "") as CalloutType;
      return CALLOUT_TYPES.includes(type) ? <Callout type={type}>{children}</Callout> : <blockquote>{children}</blockquote>;
    },
    table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto"><table className="w-full border-collapse text-sm [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2">{children}</table></div>,
    a: ({ children, href }) => {
      if (!href || !/^(https?:|mailto:|#|\/)/i.test(href.trim())) return <span>{children}</span>;
      return <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">{children}</a>;
    },
  };
  const render = () => <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkBreaks, remarkCallouts]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]} components={components}>{normalizeMath(markdown)}</ReactMarkdown>;
  const lines = markdown.split("\n").length;

  return (
    <div role="region" aria-label={`${label} copy box`} className="content-block my-3 w-full min-w-0 max-w-full">
      <div className="code-canvas content-block-frame relative flex max-h-[100cqw] flex-col overflow-hidden rounded-lg border border-border">
        <header className="content-block-header relative z-10 flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
          <span className="min-w-0 flex-1 truncate px-2 font-mono text-xs font-medium">{label}</span>
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label="Download code" title="Download Markdown" onClick={() => downloadText(markdown, "document.md")}><Download /></Button>
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label={copied ? "Copied" : `Copy ${label}`} title={copied ? "Copied" : `Copy ${label}`} onClick={() => copy(plain, copyHtml())}>{copied ? <Check /> : <Copy />}</Button>
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label="Open code full screen" title="Expand Markdown" onClick={() => setOpen(true)}><Expand /></Button>
        </header>
        <div tabIndex={0} aria-label={`${label} content`} className="relative min-h-0 shrink overflow-auto overscroll-x-contain [touch-action:pan-x_pan-y] focus-visible:outline-2 focus-visible:outline-ring">
          <div className="content-block-body flow-root">
            <div ref={body} className="max-w-none break-words p-4 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere] [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-6 [&_ul]:pl-6 [&_li]:my-0.5">{render()}</div>
          </div>
        </div>
        <div className="content-block-footer hidden h-7 shrink-0 items-center justify-between gap-2 border-t border-border px-4 font-mono text-[11px] text-muted-foreground md:flex"><span className="truncate">document.md</span><span className="shrink-0">{lines} {lines === 1 ? "line" : "lines"}</span></div>
      </div>
      {open && <FullScreenCodeView code={markdown} language="markdown" copyText={plain} copyHtml={copyHtml} markdownBody={render()} onClose={() => setOpen(false)} />}
    </div>
  );
}
