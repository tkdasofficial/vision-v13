import { useState, useEffect } from "react";
import PageHeader from "@/components/page-header";
import { useNavigate, useLocation, Outlet } from "@/lib/router-compat";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Users, CreditCard, BarChart3, Bell, ArrowLeft, Menu, X,
  MessageSquare, Zap, TrendingUp, Settings, LifeBuoy, Megaphone, ToggleLeft, ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppLogo } from "@/components/app-logo";

const NAV_GROUPS: { label: string; items: { path: string; label: string; icon: any }[] }[] = [
  {
    label: "Overview",
    items: [
      { path: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { path: "/admin/analytics", label: "Analytics", icon: TrendingUp },
      { path: "/admin/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "People",
    items: [
      { path: "/admin/users", label: "Users", icon: Users },
      { path: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { path: "/admin/support", label: "Support inbox", icon: LifeBuoy },
    ],
  },
  {
    label: "Operations",
    items: [
      { path: "/admin/chat-sessions", label: "Chat Sessions", icon: MessageSquare },
      { path: "/admin/background-tasks", label: "Background Tasks", icon: Zap },
      { path: "/admin/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/admin/announcements", label: "Announcements", icon: Megaphone },
      { path: "/admin/feature-flags", label: "Feature flags", icon: ToggleLeft },
      { path: "/admin/audit", label: "Audit log", icon: ScrollText },
      { path: "/admin/system", label: "System settings", icon: Settings },
    ],
  },
];

const AdminLayout = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    // Signed-out visitors are handled by RouteGuard; only signed-in non-admins are sent home.
    if (!loading && user && !isAdmin) navigate("/app/new", { replace: true });
  }, [user, isAdmin, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAdmin) return null;

  const NavBody = ({ onClick }: { onClick?: () => void }) => (
    <nav className="px-3 space-y-4 flex-1 overflow-y-auto py-2">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">{g.label}</p>
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => { navigate(item.path); onClick?.(); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                    active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-sidebar-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-[100dvh] w-screen overflow-hidden bg-background">
      <aside className="hidden lg:flex flex-col w-[240px] bg-sidebar border-r border-sidebar-border h-full shrink-0">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <AppLogo alt="Admin" className="w-8 h-8 rounded-full" />
          <span className="font-display font-semibold text-foreground text-sm">Admin Panel</span>
        </div>
        <NavBody />
        <div className="px-3 pb-4">
          <button onClick={() => navigate("/app/new")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            <ArrowLeft className="w-4 h-4" /><span>Back to App</span>
          </button>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className={cn("fixed top-0 left-0 bottom-0 w-[260px] bg-sidebar border-r border-sidebar-border z-50 flex flex-col transition-transform duration-300 lg:hidden", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-4 py-4">
          <span className="font-display font-semibold text-foreground text-sm">Admin Panel</span>
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <NavBody onClick={() => setMobileOpen(false)} />
        <div className="px-3 pb-4">
          <button onClick={() => navigate("/app/new")} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            <ArrowLeft className="w-4 h-4" /><span>Back to App</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <PageHeader title="Admin" onMenu={() => setMobileOpen(true)} className="border-b border-border bg-background/80 backdrop-blur-sm lg:hidden" />
        <div className="flex-1 overflow-y-auto"><Outlet /></div>
      </div>
    </div>
  );
};

export default AdminLayout;
