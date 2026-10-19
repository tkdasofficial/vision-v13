import type { ReactNode } from "react";
import { Info, Lightbulb, AlertTriangle, OctagonAlert, CircleAlert, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* Rich structured blocks for AI replies: callouts ("> [!NOTE]") and flow diagrams (```flow). */

export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const CALLOUTS: Record<CalloutType, { label: string; Icon: typeof Info; tone: string }> = {
  note: { label: "Note", Icon: Info, tone: "border-l-primary text-primary" },
  tip: { label: "Tip", Icon: Lightbulb, tone: "border-l-primary text-primary" },
  important: { label: "Important", Icon: CircleAlert, tone: "border-l-foreground text-foreground" },
  warning: { label: "Warning", Icon: AlertTriangle, tone: "border-l-destructive/70 text-destructive" },
  caution: { label: "Caution", Icon: OctagonAlert, tone: "border-l-destructive text-destructive" },
};

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };

const MARKER = /^\s*\[!(note|tip|important|warning|caution)\]\s*:?\s*\n?/i;

/** Strips a leading [!TYPE] marker from a paragraph (plain or **bold**); returns the type or null. */
function takeMarker(para: MdNode | undefined): string | null {
  if (para?.type !== "paragraph" || !para.children?.length) return null;
  let first = para.children[0];
  const wrapped = (first.type === "strong" || first.type === "emphasis") && first.children?.[0]?.type === "text" ? first : null;
  const text = wrapped ? wrapped.children![0] : first;
  if (text.type !== "text") return null;
  const m = text.value?.match(MARKER);
  if (!m) return null;
  text.value = text.value!.slice(m[0].length);
  if (!text.value) { (wrapped ?? para).children!.shift(); if (wrapped && !wrapped.children!.length) para.children!.shift(); }
  first = para.children[0];
  if (first?.type === "break") para.children.shift();
  else if (first?.type === "text") first.value = first.value!.replace(/^\s+/, "");
  return m[1].toLowerCase();
}

/** remark plugin: turns "> [!NOTE]" blockquotes — and bare "[!NOTE]" paragraphs, a common model slip —
 *  into callouts and strips the marker so raw directive text never reaches the screen. */
export function remarkCallouts() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (node.type === "blockquote") {
        const type = takeMarker(node.children?.[0]);
        if (type) {
          if (!node.children![0].children!.length) node.children!.shift();
          node.data = { ...node.data, hProperties: { "data-callout": type } };
        }
      }
      node.children?.forEach((child, i) => {
        if (node.type !== "blockquote" && child.type === "paragraph") {
          const type = takeMarker(child);
          if (type) {
            const kids: MdNode[] = child.children!.length ? [child] : [];
            // A bare marker on its own paragraph adopts the following paragraph as its body.
            const next = node.children![i + 1];
            if (!kids.length && next?.type === "paragraph") { kids.push(next); node.children!.splice(i + 1, 1); }
            node.children![i] = { type: "blockquote", children: kids, data: { hProperties: { "data-callout": type } } };
            return;
          }
        }
        walk(child);
      });
    };
    walk(tree);
  };
}

export function Callout({ type, children }: { type: CalloutType; children: ReactNode }) {
  const { label, Icon, tone } = CALLOUTS[type];
  return (
    <aside role="note" aria-label={label} className={cn("not-italic my-4 rounded-r-xl border-l-[3px] bg-muted/50 px-4 py-3", tone.split(" ")[0])}>
      <div className={cn("mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", tone.split(" ")[1])}>
        <Icon className="size-3.5" aria-hidden /> {label}
      </div>
      <div className="text-foreground [&>*:last-child]:mb-0 [&_p]:my-1">{children}</div>
    </aside>
  );
}

/** Parses "Title — description" (or ": ", " - ", "|") lines into flow steps. */
export function parseFlow(source: string) {
  return source.split("\n").map((l) => l.replace(/^\s*(?:\d+[.)]|[-*>]|→)\s*/, "").trim()).filter((l) => l && !/^(?:↓|→|->|-->|\|)$/.test(l)).map((l) => {
    const m = l.match(/^(.+?)\s+(?:—|–|-|:|\|)\s+(.+)$/) || l.match(/^(.+?):\s*(.+)$/);
    return { title: (m ? m[1] : l).replace(/\*\*/g, "").trim(), detail: m?.[2].trim() };
  });
}

export function FlowDiagram({ source }: { source: string }) {
  const steps = parseFlow(source);
  if (!steps.length) return null;
  return (
    <ol aria-label="Flow" className="not-prose my-4 list-none space-y-0 rounded-2xl border border-border p-3 sm:p-4">
      {steps.map((s, i) => (
        <li key={i} className="flex flex-col items-center">
          {i > 0 && <ArrowDown className="my-1.5 size-4 text-muted-foreground" aria-hidden />}
          <div className="w-full rounded-xl border border-border bg-card px-4 py-3 text-center">
            <div className="font-display text-[15px] font-semibold text-foreground">{s.title}</div>
            {s.detail && <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
