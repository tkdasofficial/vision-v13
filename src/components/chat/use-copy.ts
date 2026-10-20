import { useCallback, useState } from "react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

/** Copies text (and optional rich HTML) with a visible success/failure state; falls back for older mobile browsers. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string, html?: string) => {
    try {
      await copyToClipboard(text, html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }, []);
  return { copied, copy };
}
