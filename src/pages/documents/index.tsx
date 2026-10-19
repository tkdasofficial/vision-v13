import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Download, Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router-compat";
import { getDocumentFn, type DocumentResult } from "@/lib/cloud/documents.functions";
import { buildReportPdf, pdfFilename } from "@/lib/research-pdf";
import { persistExport } from '@/lib/drive-export';
import { downloadFile } from '@/lib/download';

const prose = "max-w-none text-sm leading-7 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:mt-4 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-accent [&_th]:px-2 [&_th]:py-1 [&_a]:underline";

export default function DocumentPreview() {
  const { docId } = useParams({ strict: false }) as { docId: string };
  const navigate = useNavigate();
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDocumentFn({ data: { id: docId } }).then(setResult).catch(() => setResult({ status: "missing" }));
  }, [docId]);

  const back = () => (window.history.length > 1 ? window.history.back() : navigate("/chat"));
  const doc = result?.status === "ok" ? result.doc : null;

  const makePdf = async () => {
    if (!doc) return null;
    const blob = await buildReportPdf(doc.title, doc.content);
    return new File([blob], pdfFilename(doc.title), { type: "application/pdf" });
  };

  const download = async () => {
    setBusy(true);
    try {
      const file = await makePdf();
      if (!file) return;
      await downloadFile(await persistExport(file, file.name), file.name);
    } catch { toast.error("Couldn't create the PDF."); }
    finally { setBusy(false); }
  };

  const share = async () => {
    if (!doc) return;
    const url = window.location.href;
    try {
      const file = await makePdf();
      if (file) await persistExport(file, file.name);
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: doc.title });
      else if (navigator.share) await navigator.share({ title: doc.title, url });
      else { await navigator.clipboard.writeText(url); toast.success("Link copied. Only you can open it while signed in."); }
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error("Sharing isn't available on this device.");
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button variant="ghost" size="icon" onClick={back} aria-label="Back" className="rounded-full"><ArrowLeft /></Button>
        <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold">{doc?.title ?? "Document"}</h1>
        {doc && <>
          <Button variant="ghost" size="icon" onClick={download} disabled={busy} aria-label="Download PDF" className="rounded-full">{busy ? <Loader2 className="animate-spin" /> : <Download />}</Button>
          <Button variant="ghost" size="icon" onClick={share} aria-label="Share" className="rounded-full"><Share2 /></Button>
        </>}
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8">
        {!result && <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
        {result?.status === "signin" && <Notice title="Sign in to view" text="This document is private. Sign in to open it." action={<Button onClick={() => navigate("/auth/login")}>Log in</Button>} />}
        {result?.status === "denied" && <Notice title="No access" text="You don't have permission to view this document." />}
        {result?.status === "missing" && <Notice title="Document not found" text="It may have been removed or the link is wrong." />}
        {doc && <article className={prose}><ReactMarkdown>{doc.content}</ReactMarkdown></article>}
      </main>
    </div>
  );
}

function Notice({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="py-16 text-center">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
