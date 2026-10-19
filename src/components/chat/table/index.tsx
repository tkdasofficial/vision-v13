import { Children, isValidElement, useRef, useState, type ReactNode } from "react";
import { ZoomControls, usePinchZoom } from "@/components/chat/zoom-controls";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Check, Copy, Download, Expand, Table2 } from "lucide-react";
import { Dialog, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/chat/use-copy";
import { compareTableValues, tableToCsv, type TableSort } from "@/lib/table-export";
import { exportToDrive } from '@/lib/drive-export';

type Node = { type: string; value?: string; tagName?: string; children?: Node[] };
const BR = /<br\s*\/?>/gi;
function plainText(node: Node): string {
  if (node.type === "text" || node.type === "raw") return (node.value ?? "").replace(BR, "\n").replace(/<\/?[a-z][^>]*>/gi, "");
  if (node.tagName === "br") return "\n";
  return (node.children ?? []).map(plainText).join("");
}
function elementChildren(value: ReactNode) {
  return Children.toArray(value).filter(isValidElement<{ children?: ReactNode; style?: { textAlign?: "left" | "right" | "center" } }>);
}

/** Turns literal <br> tags left in cell text into real line breaks and drops other stray tags. */
function cleanCell(value: ReactNode): ReactNode {
  return Children.map(value, (child) => {
    if (typeof child !== "string") return child;
    const parts = child.replace(/<\/?(?!br\b)[a-z][^>]*>/gi, "").split(BR);
    return parts.flatMap((part, i) => (i ? [<br key={i} />, part] : [part]));
  });
}

type TableData = {
  headers: ReturnType<typeof elementChildren>;
  rows: ReturnType<typeof elementChildren>;
  labels: string[];
  values: string[][];
};

const NUMERIC = /^[\s(+−-]*[$€£¥₹]?\s*[+−-]?(\d{1,3}([,\s]\d{3})+|\d+)?([.,]\d+)?\s*(%|[kKmMbB]|[$€£¥₹])?\)?\s*$/;
function isNumeric(value: string) {
  const v = value.trim();
  return v !== "" && /\d/.test(v) && NUMERIC.test(v);
}
type Align = "left" | "right" | "center";
function columnAlignments(data: TableData): Align[] {
  return data.headers.map((cell, column) => {
    const explicit = cell.props.style?.textAlign;
    if (explicit === "right" || explicit === "center") return explicit;
    const filled = data.values.map((row) => row[column] ?? "").filter((v) => v.trim() !== "" && !/^[-–—]$/.test(v.trim()));
    return filled.length > 0 && filled.every(isNumeric) ? "right" : "left";
  });
}
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right tabular-nums", center: "text-center" };

function TableGrid({ data, sort, onSort, full, zoom = 1 }: { data: TableData; sort: TableSort; onSort: (column: number) => void; full?: boolean; zoom?: number }) {
  const order = data.rows.map((_, index) => index);
  if (sort) order.sort((a, b) => (sort.direction === "ascending" ? 1 : -1) * compareTableValues(data.values[a]?.[sort.column] ?? "", data.values[b]?.[sort.column] ?? "") || a - b);
  const align = columnAlignments(data);
  const width = full ? "min-w-32 max-w-[28rem]" : "min-w-28 max-w-80";
  return (
    <table style={zoom !== 1 ? { zoom } : undefined} className="m-0 w-max min-w-full border-separate border-spacing-0 text-sm leading-6">
      <thead>
        <tr>{data.headers.map((cell, index) => {
          const active = sort?.column === index;
          const Icon = active ? sort.direction === "ascending" ? ArrowUp : ArrowDown : ArrowUpDown;
          const label = data.labels[index] || `Column ${index + 1}`;
          const right = align[index] === "right";
          return <th key={index} scope="col" aria-sort={active ? sort.direction : "none"} className={`sticky top-0 z-10 ${width} border-b border-r border-border bg-muted p-0 align-bottom font-semibold text-foreground last:border-r-0`}>
            <Button variant="ghost" className={`h-auto min-h-11 w-full gap-2 whitespace-normal rounded-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground ${right ? "flex-row-reverse justify-start text-right" : align[index] === "center" ? "justify-center text-center" : "justify-between text-left"} ${active ? "text-foreground" : ""}`} aria-label={`Sort by ${label}`} title={`Sort by ${label}`} onClick={() => onSort(index)}>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{cleanCell(cell.props.children)}</span><Icon className={`size-3.5 shrink-0 ${active ? "text-primary" : "opacity-60"}`} aria-hidden="true" />
            </Button>
          </th>;
        })}</tr>
      </thead>
      <tbody>{order.map((rowIndex) => <tr key={rowIndex} className="group even:bg-muted/30 hover:bg-accent/50">{elementChildren(data.rows[rowIndex]?.props.children).map((cell, column) => <td key={column} className={`${width} whitespace-pre-wrap break-words border-b border-r border-border px-3 py-2.5 align-top [overflow-wrap:anywhere] last:border-r-0 group-last:border-b-0 ${ALIGN[align[column] ?? "left"]}`}>{cleanCell(cell.props.children)}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default function TableReply({ children, node, markdown }: { children: ReactNode; node?: Node; markdown: string }) {
  const [sort, setSort] = useState<TableSort>(null);
  const [open, setOpen] = useState(false);
  const [zoom, setZoomRaw] = useState(1);
  const setZoom = (value: number) => setZoomRaw(Math.round(Math.min(2.5, Math.max(0.5, value)) * 20) / 20);
  const fullArea = useRef<HTMLDivElement>(null);
  usePinchZoom(fullArea, () => zoom, setZoom, 0.1);
  const { copied, copy } = useCopy();
  const sections = elementChildren(children);
  const header = sections.find((section) => section.type === "thead");
  const body = sections.find((section) => section.type === "tbody");
  const headerRow = header ? elementChildren(header.props.children)[0] : undefined;
  const headers = headerRow ? elementChildren(headerRow.props.children) : [];
  const rows = body ? elementChildren(body.props.children) : [];
  const astHeader = node?.children?.find((child) => child.tagName === "thead")?.children?.find((child) => child.tagName === "tr");
  const labels = (astHeader?.children ?? []).filter((child) => child.tagName === "th").map(plainText);
  const astRows = node?.children?.find((child) => child.tagName === "tbody")?.children?.filter((child) => child.tagName === "tr") ?? [];
  const values = astRows.map((row) => (row.children ?? []).filter((child) => child.tagName === "td").map(plainText));
  const data: TableData = { headers, rows, labels, values };
  const order = rows.map((_, index) => index);
  if (sort) order.sort((a, b) => (sort.direction === "ascending" ? 1 : -1) * compareTableValues(values[a]?.[sort.column] ?? "", values[b]?.[sort.column] ?? "") || a - b);
  function toggleSort(column: number) {
    setSort((current) => current?.column === column ? current.direction === "ascending" ? { column, direction: "descending" } : null : { column, direction: "ascending" });
  }
  function download() {
    void exportToDrive(new Blob(["\uFEFF", tableToCsv([labels, ...order.map((index) => values[index] ?? [])])], { type: "text/csv;charset=utf-8" }), 'vision-table.csv');
  }
  return (
    <section aria-label="Table output" className="content-block not-prose my-3 w-full min-w-0 max-w-full">
      <div className="content-block-frame relative flex max-h-[100cqw] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground">
        <header className="content-block-header relative z-10 flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate px-2 font-mono text-xs font-medium" title={`Table · ${rows.length} rows · ${headers.length} columns`}><Table2 className="size-4 shrink-0" aria-hidden="true" />Table</span>
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label={copied ? "Table copied" : "Copy table Markdown"} title={copied ? "Copied" : "Copy table Markdown"} onClick={() => copy(markdown)}>{copied ? <Check /> : <Copy />}</Button>
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label="Download table CSV" title="Download table CSV" onClick={download}><Download /></Button>
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full md:size-8 md:rounded-md" aria-label="Open table full screen" title="Open full screen" onClick={() => setOpen(true)}><Expand /></Button>
        </header>
        <div role="region" aria-label="Scrollable table" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <TableGrid data={data} sort={sort} onSort={toggleSort} />
        </div>
      </div>
      {open && <Dialog open onOpenChange={(value) => { if (!value) setOpen(false); }}><DialogPortal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[9999] bg-background" />
        <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-[10000] flex h-dvh min-w-0 flex-col bg-background text-foreground outline-none pb-[env(safe-area-inset-bottom)]">
          <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-border px-2 pt-[env(safe-area-inset-top)]">
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full md:rounded-md" onClick={() => setOpen(false)} aria-label="Back to chat" title="Back to chat"><ArrowLeft /></Button>
            <DialogTitle className="min-w-0 flex-1 truncate px-1 font-mono text-sm font-medium">Table <span className="font-sans text-xs font-normal text-muted-foreground">· {rows.length} rows · {headers.length} columns</span></DialogTitle>
            <div className="flex shrink-0 items-center gap-1">
              <ZoomControls percent={Math.round(zoom * 100)} canOut={zoom > 0.5} canIn={zoom < 2.5} onOut={() => setZoom(zoom - 0.1)} onIn={() => setZoom(zoom + 0.1)} onReset={() => setZoom(1)} />
              <Button variant="ghost" size="icon" className="rounded-full md:rounded-md" onClick={download} aria-label="Download table CSV" title="Download table CSV"><Download /></Button>
              <Button variant="ghost" size="icon" className="rounded-full md:rounded-md" onClick={() => copy(markdown)} aria-label={copied ? "Copied" : "Copy table Markdown"} title={copied ? "Copied" : "Copy table Markdown"}>{copied ? <Check /> : <Copy />}</Button>
            </div>
          </header>
          <div ref={fullArea} role="region" aria-label="Scrollable table" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <TableGrid data={data} sort={sort} onSort={toggleSort} full zoom={zoom} />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal></Dialog>}
    </section>
  );
}
