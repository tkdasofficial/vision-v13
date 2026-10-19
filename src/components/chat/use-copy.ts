import { useCallback, useState } from "react";
import { toast } from "sonner";

/** Copies text (and optional rich HTML) with a visible success/failure state; falls back for older mobile browsers. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string, html?: string) => {
    try {
      const CI = (globalThis as any).ClipboardItem;
      if (html && CI && navigator.clipboard?.write) {
        await navigator.clipboard.write([new CI({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy"); ta.remove();
        if (!ok) throw new Error("copy failed");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access.");
    }
  }, []);
  return { copied, copy };
}
