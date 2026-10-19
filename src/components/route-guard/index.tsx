import type { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "@/lib/router-compat";
import { classifyRoute, loginPathFor, postLoginPath } from "@/lib/route-access";

function Loading({ offline = false }: { offline?: boolean }) {
  return (
    <div role="status" aria-label="Loading" data-testid="auth-loading" className="min-h-[100dvh] bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
        {offline && <p className="text-sm text-muted-foreground">Can't reach Vision. Retrying…</p>}
      </div>
    </div>
  );
}

/** Central access check for every page; renders nothing of the page until allowed. */
export function RouteGuard({ children }: { children: ReactNode }) {
  const { user, loading, offline } = useAuth();
  const location = useLocation();
  const access = classifyRoute(location.pathname);

  if (access === "public" || access === "recovery") return <>{children}</>;
  if (loading) return <Loading offline={offline} />;
  if (access === "protected" && !user) {
    return <><Loading /><Navigate to={loginPathFor(location.href)} replace /></>;
  }
  if (access === "guest" && user) {
    return <><Loading /><Navigate to={postLoginPath()} replace /></>;
  }
  return <>{children}</>;
}
