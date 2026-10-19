import { useEffect, useState } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { isChunkError, nextSoftRetryDelay, recoverFromChunkError } from "@/lib/chunk-recovery";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/** Error screen for any route. Page-file download failures retry in place instead of reloading. */
export default function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const chunk = isChunkError(error);
  const [retrying, setRetrying] = useState(chunk);
  useEffect(() => {
    if (chunk) {
      // A page file didn't download: try again in place first, so nothing on screen is lost.
      const delay = nextSoftRetryDelay();
      if (delay !== null) {
        setRetrying(true);
        const t = window.setTimeout(() => { router.invalidate(); reset(); }, delay);
        return () => window.clearTimeout(t);
      }
      if (recoverFromChunkError()) return; // published site: one reload to pick up the new version
    }
    setRetrying(false);
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, chunk, reset, router]);

  if (retrying) {
    return (
      <div role="status" aria-label="Loading" className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try again or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
