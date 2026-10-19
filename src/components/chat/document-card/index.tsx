import { FileText, ChevronRight } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";

// Compact research report card; opens the preview page.
export default function DocumentCard({ id, title }: { id: string; title: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/documents/${id}`)}
      className="flex h-[72px] w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent"><FileText className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">Research report · PDF</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
