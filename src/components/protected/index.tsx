import type { ReactNode } from "react";

// Access is enforced once, centrally, by RouteGuard in the root route (see src/lib/route-access.ts).
// Kept as a marker so route files stay readable; it adds no second check.
export function Protected({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
