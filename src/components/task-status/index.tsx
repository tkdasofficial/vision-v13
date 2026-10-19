import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

export default function TaskStatus({ label, startedAt, endedAt, failed = false, cancelled = false, seconds: measuredSeconds, finished = false, details }: {
  label: string; startedAt: string | Date; endedAt?: string; failed?: boolean; cancelled?: boolean;
  seconds?: number; finished?: boolean; details?: string[];
}) {
  const [dots, setDots] = useState(0);
  const [open, setOpen] = useState(false);
  const live = !finished && !endedAt && !failed && !cancelled;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setDots((v) => (v + 1) % 4), 400);
    return () => window.clearInterval(timer);
  }, [live]);
  const seconds = Math.max(0, Math.round(measuredSeconds ?? ((endedAt ? Date.parse(endedAt) : NaN) - new Date(startedAt).getTime()) / 1000)) || 0;
  const text = failed || cancelled ? `Failed after ${seconds}s` : live ? label : `Worked for ${seconds}s`;
  return <div className="w-full py-1 text-sm text-foreground">
    {!live && details?.length ? <Button variant="ghost" className="h-auto justify-start gap-1 px-0 py-0 text-sm font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{text}<ChevronRight className={`size-3 transition-transform ${open ? "rotate-90" : ""}`} /></Button> : <span role="status" aria-live="polite" className="break-words font-medium">{text}{live && <span className="text-muted-foreground">{".".repeat(dots)}</span>}</span>}
    {open && <ol className="mt-2 space-y-1 text-xs text-muted-foreground">{details?.map((detail, i) => <li key={i} className="break-words">{detail}</li>)}</ol>}
  </div>;
}
