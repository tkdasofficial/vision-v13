import { type ReactNode } from "react";
import { useLocation, useNavigate } from "@/lib/router-compat";
import PageHeader, { type PageMenuItem } from "@/components/page-header";

export default function WorkspaceShell({ title, children, actions, backTo, footer, menu }: { title: string; children: ReactNode; actions?: ReactNode; backTo?: string; footer?: ReactNode; menu?: PageMenuItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  return <div className="flex h-[100dvh] overflow-hidden bg-background">
    <main className="flex min-w-0 flex-1 flex-col">
      <PageHeader title={title} backTo={backTo} onMenu={backTo ? undefined : () => navigate(`/drawer?returnTo=${encodeURIComponent(location.pathname)}`)} actions={actions} menu={menu} />
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8"><div className="mx-auto max-w-4xl">{children}</div></div>
      {footer}
    </main>
  </div>;
}