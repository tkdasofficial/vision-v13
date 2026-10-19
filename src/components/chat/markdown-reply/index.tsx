import { Children, isValidElement, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { normalizeMath } from "@/lib/math";
import CodeBlock from "@/components/chat/code";
import TextCopyBox from "@/components/chat/text-copy-box";
import CopyReadyBox from "@/components/chat/markdown";
import TableReply from "@/components/chat/table";
import { Callout, FlowDiagram, remarkCallouts, CALLOUT_TYPES, type CalloutType } from "@/components/chat/rich-blocks";
import { dedupeDeliverables } from "@/lib/markdown-plain";

// "markdown" fences are copy-ready deliverables (rendered); text/prompt/untagged fences stay literal.
const rawLanguages = new Set(["", "text", "txt", "plain", "plaintext", "prompt"]);
const renderedLanguages = new Set(["markdown", "md"]);
const flowLanguages = new Set(["flow", "steps", "pipeline"]);
const safeHref = (href?: string) => (href && /^(https?:|mailto:|#|\/)/i.test(href.trim()) ? href : undefined);

const components: Components = {
  pre: ({ children, node }) => {
    const child = Children.toArray(children).find((item) => isValidElement(item));
    if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) return <pre>{children}</pre>;
    const language = child.props.className?.replace(/^language-/, "").toLowerCase() || "";
    const text = String(child.props.children ?? "").replace(/\n$/, "");
    if (flowLanguages.has(language)) return <FlowDiagram source={text} />;
    if (renderedLanguages.has(language)) return <CopyReadyBox markdown={text} renderCode={(code, lang) => rawLanguages.has(lang) ? <TextCopyBox text={code} label="Text" /> : <CodeBlock code={code} language={lang} />} />;
    if (rawLanguages.has(language)) return <TextCopyBox text={text} label={language === "prompt" ? "Prompt" : "Text"} />;
    const codeNode = node?.children.find((item) => item.type === "element" && item.tagName === "code");
    const data = codeNode?.data;
    const meta = data && "meta" in data ? String(data.meta ?? "") : "";
    return <CodeBlock code={text} language={language} filename={meta.match(/title="([^"]+)"/)?.[1]} />;
  },
  code: ({ children, className }) => <code className={className}>{children}</code>,
  blockquote: ({ children, node }) => {
    const type = String(node?.properties?.dataCallout ?? (node?.properties as any)?.["data-callout"] ?? "") as CalloutType;
    return CALLOUT_TYPES.includes(type) ? <Callout type={type}>{children}</Callout> : <blockquote>{children}</blockquote>;
  },
  a: ({ children, href }) => {
    const safe = safeHref(href);
    return safe ? <a href={safe} target={safe.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer nofollow">{children}</a> : <span>{children}</span>;
  },
};

export default function MarkdownReply({ children }: { children: string }) {
  const source = useMemo(() => normalizeMath(dedupeDeliverables(children)), [children]);
  // Scoped AI Elements exception: Streamdown drops TableReply's nested row children
  // (table-generation and currency regressions). Keep the source-position-aware renderer.
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkCallouts]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", output: "htmlAndMathml" }]]} components={{ ...components, table: ({ children: tableChildren, node }) => <TableReply node={node} markdown={source.slice(node?.position?.start.offset ?? 0, node?.position?.end.offset ?? source.length)}>{tableChildren}</TableReply> }}>{source}</ReactMarkdown>;
}
