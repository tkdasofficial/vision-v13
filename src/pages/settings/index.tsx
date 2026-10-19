import { useState, type ComponentType } from "react";
import { Palette, Languages, Sparkles, MessagesSquare, Database, ShieldCheck, PersonStanding, Bell, Info, User, Inbox, Crown, LayoutDashboard, HelpCircle, LifeBuoy, BookOpen, LogOut, ChevronRight, Pencil, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "@/lib/router-compat";

export const SETTINGS_CATEGORIES = [
  { to: "/settings/appearance", icon: Palette, title: "Appearance", desc: "Theme, accent colour and text size" },
  { to: "/settings/language", icon: Languages, title: "Language", desc: "Interface language" },
  { to: "/settings/ai", icon: Sparkles, title: "AI Preferences", desc: "Default mode, answer style, custom instructions" },
  { to: "/settings/chat", icon: MessagesSquare, title: "Chat & History", desc: "Export or clear conversations" },
  { to: "/settings/privacy", icon: Database, title: "Privacy & Data", desc: "Your data, research documents and deletion" },
  { to: "/settings/security", icon: ShieldCheck, title: "Security", desc: "Password and two-step sign-in" },
  { to: "/settings/accessibility", icon: PersonStanding, title: "Accessibility", desc: "Motion, contrast and tap size" },
  { to: "/settings/notifications", icon: Bell, title: "Notifications", desc: "Browser alerts" },
  { to: "/settings/about", icon: Info, title: "About VISION", desc: "Version, help and legal" },
] as const;

type Row = { to: string; icon: ComponentType<{ className?: string }>; title: string };

function Group({ title, rows }: { title?: string; rows: Row[] }) {
  const navigate = useNavigate();
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-5 text-xs font-medium uppercase tracking-normal text-muted-foreground">{title}</h2>
      <div className="space-y-1.5">
        {rows.map(({ to, icon: Icon, title: label }) => (
          <Button key={to + label} variant="floating" onClick={() => navigate(to)} className="h-auto min-h-12 w-full justify-start gap-3 whitespace-normal rounded-full px-5 py-3 text-left text-sm font-medium focus-visible:ring-inset focus-visible:ring-offset-0 [&_svg]:size-5">
            <Icon className="text-muted-foreground" />
            <span className="min-w-0 flex-1">{label}</span>
            <ChevronRight className="text-muted-foreground opacity-50" />
          </Button>
        ))}
      </div>
    </section>
  );
}

export default function SettingsDirectory() {
  const { profile, user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const name = profile?.full_name || "User";
  const email = profile?.email || user?.email;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "U";
  const avatar = profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="size-full object-cover" /> : initials;

  const account: Row[] = [
    { to: "/account", icon: User, title: "Manage account" },
    { to: "/inbox", icon: Inbox, title: "Inbox" },
    ...(isAdmin ? [{ to: "/admin/dashboard", icon: LayoutDashboard, title: "Admin Panel" }] : []),
  ];
  const help: Row[] = [
    { to: "/guide", icon: BookOpen, title: "App Guide" },
    { to: "/support", icon: LifeBuoy, title: "Support" },
    { to: "/help/faq", icon: HelpCircle, title: "FAQ" },
    { to: "/settings/about", icon: Info, title: "About Vision" },
  ];

  return (
    <div className="app-drawer relative grid h-[100dvh] grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-settings-canvas text-foreground" data-scrolled={scrolled}>
      <header className="drawer-top relative z-10 col-start-1 row-start-1 self-start px-4 pb-5 pt-[max(12px,env(safe-area-inset-top))] sm:px-8">
        <div className="mx-auto grid h-11 max-w-xl grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3">
          <Button variant="floating" size="icon" className="size-11 shrink-0 rounded-full [&_svg]:size-5" aria-label="Back" title="Back" onClick={() => navigate("/drawer")}><ArrowLeft /></Button>
          <h1 className="drawer-floating flex h-11 max-w-full items-center justify-center justify-self-center rounded-full px-6 text-center font-display text-xl font-semibold"><span className="truncate">Settings</span></h1>
          <span aria-hidden="true" />
        </div>
      </header>
      <div className="col-start-1 row-start-1 min-h-0 overflow-y-auto px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(72px,calc(env(safe-area-inset-top)+60px))] sm:px-8" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 8)}>
        <div className="mx-auto max-w-xl space-y-4">
          <Button variant="floating" onClick={() => navigate("/account")} aria-label="Edit profile" className="h-auto min-h-20 w-full justify-start gap-3 whitespace-normal rounded-full px-5 py-4 text-left">
            <span className="relative shrink-0">
              <span className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-secondary text-base font-semibold">{avatar}</span>
              <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-settings-surface bg-secondary"><Pencil className="size-2.5" /></span>
            </span>
            <span className="min-w-0 flex-1"><span className="block break-words font-display text-base font-semibold">{name}</span>{email && <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{email}</span>}</span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
          </Button>
          <Button variant="floating" onClick={() => navigate("/billing/plans")} className="h-auto min-h-12 w-full justify-start gap-3 rounded-full px-5 py-3 text-sm [&_svg]:size-5"><Crown className="text-muted-foreground" /><span className="flex-1 text-left">Upgrade plan</span><ChevronRight className="text-muted-foreground opacity-50" /></Button>
          <Group title="Account" rows={account} />
          <Group title="Preferences" rows={SETTINGS_CATEGORIES.filter(({ to }) => to !== "/settings/about").map(({ to, icon, title }) => ({ to, icon, title }))} />
          <Group title="Help" rows={help} />
          <Button variant="floating" disabled={signingOut} onClick={async () => { setSigningOut(true); setSignOutError(false); try { await signOut(); navigate("/auth/login", { replace: true }); } catch { setSignOutError(true); setSigningOut(false); } }} className="h-auto min-h-12 w-full justify-start gap-3 rounded-full px-5 py-3 text-sm text-destructive [&_svg]:size-5">{signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}{signingOut ? "Logging out…" : "Log out"}</Button>
          {signOutError && <p role="alert" className="px-5 text-sm text-destructive">Couldn’t log out. Please try again.</p>}
          <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            <Button variant="floating" onClick={() => navigate("/legal/privacy")} className="h-9 rounded-full px-3 text-xs text-muted-foreground">Privacy Policy</Button><span aria-hidden="true">·</span><Button variant="floating" onClick={() => navigate("/legal/terms")} className="h-9 rounded-full px-3 text-xs text-muted-foreground">Terms of Service</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
