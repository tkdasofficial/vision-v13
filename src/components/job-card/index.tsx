import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Download, RotateCcw, Square, ChevronDown, FileCode2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JOB_STATUSES, isTerminal, type JobView } from "@/lib/builder/statuses";
import { cancelJob, downloadUrl, fetchJob, retryJob } from "@/lib/builder/jobs-client";
import { downloadFile } from "@/lib/download";
import { toast } from "sonner";
import TaskStatus from "@/components/task-status";
import { visibleJobStatus } from "@/lib/status-visibility";
import { workStateForJob, workStateLabel } from "@/lib/ai/work-status";
import { canShowJobContents } from "@/lib/builder/file-delivery";
import { followJob } from "@/lib/builder/job-recovery";

/** Downloads through an authenticated fetch so the session always reaches the server. */
function ArtifactButton({ id, name, size }: { id: string; name: string; size?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" size="sm" variant="secondary" className="h-auto min-h-12 w-full max-w-full justify-start gap-3 rounded-lg px-3 py-2 text-left whitespace-normal sm:w-auto" disabled={busy} aria-label={`Download ${name}`} title={`Download ${name}`}
      onClick={async () => { setBusy(true); try { await downloadFile(downloadUrl(id), name); } catch (e: any) { toast.error(e?.message || "The file couldn't be downloaded."); } finally { setBusy(false); } }}>
      {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1"><span className="block break-all">{name}</span><span className="block text-xs font-normal text-muted-foreground">{busy ? "Downloading…" : "Download"}{size && ` · ${size}`}</span></span>
    </Button>
  );
}
import CodeBlock from "@/components/chat/code";
import MarkdownReply from "@/components/chat/markdown-reply";
import { looksLikeCode } from "@/components/chat/highlight";

const md = { pre: ({ children }: any) => <>{children}</>, code: ({ children, className, node }: any) => {
  const text = String(children);
  if (className?.startsWith("language-") || text.includes("\n")) return <CodeBlock code={text.replace(/\n$/, "")} language={className?.replace("language-", "") || undefined} filename={String(node?.data?.meta ?? "").match(/title="([^"]+)"/)?.[1]} />;
  return <code className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
} };
const CleanText = ({ text }: { text: string }) => looksLikeCode(text)
  ? <CodeBlock code={text.trim()} />
  : <div className="prose prose-sm max-w-none text-foreground dark:prose-invert [&_pre]:my-0"><ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{text.slice(0, 60000)}</ReactMarkdown></div>;

const TITLES = { code_export: "Code file", project_generate: "Project", zip_analyze: "ZIP analysis", agent_task: "Task", runtime_task: "Background task", long_context: "Long document" } as const;
const fmt = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);


function StatusIcon({ status }: { status: JobView["status"] }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (status === "completed_with_warnings") return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
  if (status === "failed" || status === "timed_out") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "cancelled") return <Ban className="h-4 w-4 text-muted-foreground" />;
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

export default function JobCard({ job: given, onRetry, compact }: { job: JobView; onRetry?: (id: string) => void; compact?: boolean }) {
  const [job, setJob] = useState(given);
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => { setJob((cur) => (cur.id !== given.id || (!isTerminal(cur.status) || isTerminal(given.status)) && Date.parse(given.updatedAt) >= Date.parse(cur.updatedAt) ? given : cur)); }, [given]);
  // Reload the stored state (e.g. after a page refresh) and keep following it until it finishes.
  useEffect(() => {
    let stop = false;
    void followJob(given.id, fetchJob, (j) => setJob((cur) => ((!isTerminal(cur.status) || isTerminal(j.status)) && Date.parse(j.updatedAt) >= Date.parse(cur.updatedAt) ? j : cur)), () => stop);
    return () => { stop = true; };
  }, [given.id]);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (onRetry) { onRetry(job.id); return; }
    setRetrying(true);
    try { await retryJob(job.id, setJob); }
    catch (e) { toast.error(e instanceof Error ? e.message : "The task couldn't restart."); }
    finally { setRetrying(false); }
  };
  const running = !isTerminal(job.status);
  const visible = visibleJobStatus(job);
  const stageLabel = workStateLabel(workStateForJob(visible.status)) ?? JOB_STATUSES[visible.status];
  const statusLine = <TaskStatus label={stageLabel} startedAt={job.createdAt} endedAt={running ? undefined : job.updatedAt} failed={job.status === "failed" || job.status === "timed_out"} cancelled={job.status === "cancelled"} />;
  const r = job.result ?? {};
  const showContents = canShowJobContents(job);
  if (job.type === "long_context" && (job.status === "completed" || job.status === "completed_with_warnings") && job.artifacts.length) {
    return <div className="space-y-3">{statusLine}<div className="flex flex-wrap gap-2">{job.artifacts.map((a) => <ArtifactButton key={a.id} id={a.id} name={a.name} size={fmt(a.size)} />)}</div>{showContents && r.content && <CleanText text={r.content} />}</div>;
  }
  // Story/prompt output is inline; only explicitly requested files have download controls.
  if (job.type === "runtime_task" && (r.operation === "story_generate" || r.operation === "prompt_generate") && (job.status === "completed" || job.status === "completed_with_warnings")) {
    return <div className="space-y-3">
      {statusLine}
      {r.content && <MarkdownReply>{r.content}</MarkdownReply>}
      {r.fileRequested === true && job.artifacts.length > 0 && <div className="flex flex-wrap gap-2">{job.artifacts.map((a) => <ArtifactButton key={a.id} id={a.id} name={a.name} size={fmt(a.size)} />)}</div>}
    </div>;
  }
  // File deliveries never expose their contents unless the request opted in.
  if (job.type === "code_export" && (job.status === "completed" || job.status === "completed_with_warnings")) {
    return <div className="space-y-3">
      {statusLine}
      <div className="flex flex-wrap gap-2">{job.artifacts.map((a) => <ArtifactButton key={a.id} id={a.id} name={a.name} />)}</div>
      {showContents && r.content && <CodeBlock code={r.content} language={r.language} filename={r.fileName} />}
    </div>;
  }
  // Finished tasks show only their result — no title, status words, step list or tick.
  if (job.type === "agent_task" && job.status === "completed" && (r.answer || r.steps?.length)) {
    const last = r.steps?.length ? r.steps[r.steps.length - 1] : null;
    return (
      <div className="space-y-3">
        {statusLine}
        {showContents && r.steps?.map((s: any, i: number) => s.preview?.kind === "svg" && <img key={i} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.preview.content)}`} alt="" className="max-h-96 w-full rounded-xl border border-border bg-background object-contain" />)}
        {job.artifacts.length > 0 && <div className="flex flex-wrap gap-2">{job.artifacts.map((a) => <ArtifactButton key={a.id} id={a.id} name={a.name} />)}</div>}
        {showContents && <CleanText text={r.displayText ?? (last ? (last.preview?.kind === "markdown" ? last.preview.content : last.text ?? "") : r.answer ?? "")} />}
      </div>
    );
  }
  // While working: the work-state line only — no card, no icons.
  if (running) return statusLine;
  return (
    <div className="space-y-2 text-foreground">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" className="h-auto min-w-0 gap-1 px-0 py-0 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Show task details">
          {statusLine}<ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
        </Button>
        <div className="flex shrink-0 gap-1">
          {running && <Button size="sm" variant="ghost" disabled={cancelling} onClick={async () => { setCancelling(true); await cancelJob(job.id).catch(() => setCancelling(false)); }} aria-label="Cancel task"><Square className="h-3.5 w-3.5" /></Button>}
          {(job.status === "failed" || job.status === "cancelled" || job.status === "timed_out") && <Button size="sm" variant="ghost" disabled={retrying} onClick={retry} aria-label="Retry task"><RotateCcw className="h-3.5 w-3.5" /></Button>}
        </div>
      </div>

      {job.artifacts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {job.artifacts.map((a) => (
            <ArtifactButton key={a.id} id={a.id} name={a.name} size={fmt(a.size)} />
          ))}
        </div>
      )}

      {job.type === "runtime_task" && r.checksum && (
        <div className="mt-3 space-y-1 rounded-xl bg-muted p-3 font-mono text-xs break-all">
          {r.checksum.sha256 && <p><span className="font-sans font-medium">SHA-256</span> {r.checksum.sha256}</p>}
          {r.checksum.sha512 && <p><span className="font-sans font-medium">SHA-512</span> {r.checksum.sha512}</p>}
          {r.checksum.verify && <p className="font-sans font-medium">{r.checksum.verify.match ? "Matches the expected checksum" : "Does NOT match the expected checksum"}</p>}
        </div>
      )}
      {job.type === "runtime_task" && r.details && (
        <p className="mt-2 text-xs text-muted-foreground">
          {[r.details.from && `${String(r.details.from).toUpperCase()} → ${String(r.details.to).toUpperCase()}`, !r.details.from && r.details.to && `→ ${String(r.details.to).toUpperCase()}`, r.details.width && `${r.details.width}×${r.details.height}`, r.details.duration && `${r.details.duration}s`, r.details.video_codec && `${r.details.video_codec}${r.details.audio_codec ? ` + ${r.details.audio_codec}` : ""}`, r.inputSize && r.outputSize && `${fmt(r.inputSize)} → ${fmt(r.outputSize)}`].filter(Boolean).join(" · ")}
        </p>
      )}
      {job.type === "agent_task" && (r.answer || r.steps?.length) && (
        <div className="mt-3 space-y-3">
          {showContents && r.displayText && <CleanText text={r.displayText} />}
          {showContents && r.answer && !r.steps?.length && <div className="prose prose-sm max-w-none text-foreground dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.answer}</ReactMarkdown></div>}
          {r.steps?.map((s: any, i: number) => (
            <div key={i} className="space-y-2">
              {r.steps.length > 1 && <p className="text-xs font-medium text-muted-foreground">{i + 1}. {s.category} · {s.tool}</p>}
              {s.error && <p className="text-xs text-destructive">{s.error}</p>}
              {showContents && s.preview?.kind === "svg" && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.preview.content)}`} alt={`${s.tool} result`} className="max-h-96 w-full rounded-xl border border-border bg-background object-contain" />}
              {showContents && !r.displayText && s.text && (i === r.steps.length - 1 || s.preview?.kind !== "markdown") && (
                <div className="prose prose-sm max-h-[28rem] max-w-none overflow-auto rounded-xl bg-muted p-3 text-foreground dark:prose-invert"><ReactMarkdown remarkPlugins={[remarkGfm]}>{(s.preview?.kind === "markdown" ? s.preview.content : s.text).slice(0, 20000)}</ReactMarkdown></div>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          {(job.status === "failed" || job.status === "timed_out") && <div className="space-y-1 text-xs"><p className="font-medium">Failed step: {JOB_STATUSES[visible.steps.findLast((s) => s.outcome === "error" && !isTerminal(s.status))?.status ?? visible.steps.findLast((s) => !isTerminal(s.status))?.status ?? "processing"]}</p><p className="break-words text-destructive">{job.error || visible.detail || "The task ended without a recorded cause."}</p></div>}
          <ol className="space-y-1">
            {visible.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", s.outcome === "error" ? "bg-destructive" : s.outcome === "warn" ? "bg-muted-foreground" : s.endedAt ? "bg-primary" : "animate-pulse bg-foreground")} />
                <span className="font-medium">{JOB_STATUSES[s.status] ?? s.status}</span>
                <span className="text-muted-foreground">{s.detail}</span>
              </li>
            ))}
          </ol>
          {job.warnings.length > 0 && (
            <div className="rounded-xl bg-muted p-3 text-xs">
              <p className="mb-1 font-medium">Warnings</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{job.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {job.type === "project_generate" && r.files && (
            <div>
              <p className="mb-1 text-xs font-medium">{r.stackLabel} · {r.files.length} files</p>
              <ul className="max-h-56 overflow-y-auto rounded-xl bg-muted p-2 font-mono text-xs">{r.files.map((f: any) => (
                <li key={f.path}>
                  <button type="button" onClick={() => setViewing((v) => (v === f.path ? null : f.path))} aria-expanded={viewing === f.path} className={cn("flex w-full justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-background", viewing === f.path && "bg-background")}>
                    <span className="truncate"><FileCode2 className="mr-1 inline h-3 w-3" />{f.path}</span><span className="shrink-0 text-muted-foreground">{fmt(f.size)}</span>
                  </button>
                </li>))}</ul>
              {(viewing || showContents) && (() => { const files = r.webApp?.files ?? []; const selected = viewing ? files.filter((x: any) => x.path === viewing) : files; return selected.map((file: any) => <pre key={file.path} className="mt-2 max-h-80 overflow-auto rounded-xl bg-muted p-3 text-xs"><code>{file.content}</code></pre>); })()}
              {r.validation && <p className="mt-2 text-xs text-muted-foreground">Checked: {r.validation.checked.join(", ")}. Not checked: {r.validation.notChecked.join("; ")}.</p>}
            </div>
          )}
          {job.type === "code_export" && showContents && r.content && (
            <pre className="max-h-72 overflow-auto rounded-xl bg-muted p-3 text-xs"><code>{r.content}</code></pre>
          )}
          {job.type === "zip_analyze" && r.analysis && (
            <div className="space-y-2 text-xs">
              <p><span className="font-medium">Stack:</span> {r.analysis.stack.join(", ") || "Not detected"} · {r.analysis.inventory.files} files · {fmt(r.analysis.inventory.totalBytes)}</p>
              {r.analysis.findings.length > 0 && (
                <ul className="space-y-1">{r.analysis.findings.slice(0, 12).map((f: any, i: number) => <li key={i}><Badge variant={f.severity === "high" ? "destructive" : "outline"} className="mr-1.5 rounded-full text-[10px] uppercase">{f.severity}</Badge>{f.title}{f.path ? <span className="text-muted-foreground"> — {f.path}</span> : null}</li>)}</ul>
              )}
              <pre className="max-h-56 overflow-auto rounded-xl bg-muted p-3 font-mono">{r.analysis.tree}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
