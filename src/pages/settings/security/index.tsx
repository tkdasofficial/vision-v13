import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Lock, ChevronRight } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { securityStatusFn, changePasswordFn } from "@/lib/cloud/account-security.functions";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/settings-ui";

const field = "h-14 w-full drawer-floating rounded-full px-5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring";

export default function Security() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ hasPassword: boolean; providers: string[]; email: string } | null>(null);
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { securityStatusFn().then(setStatus).catch(() => toast.error("Couldn't load security info.")); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return toast.error("New passwords don't match.");
    setBusy(true);
    try {
      const r = await changePasswordFn({ data: { current: cur, next } });
      if (r.error) toast.error(r.error); else { toast.success("Password changed. Other devices were signed out."); setCur(""); setNext(""); setAgain(""); setOpen(false); }
    } catch { toast.error("Couldn't change password."); }
    setBusy(false);
  };

  return (
    <SettingsPage title="Security" loading={!status}>
      {status && (
        <>
          <SettingsSection title="Sign-in methods">
            <SettingsRow label="Email"><span className="min-w-0 truncate text-sm text-muted-foreground">{status.email}</span></SettingsRow>
            {status.providers.map((p) => <SettingsRow key={p} label={p[0].toUpperCase() + p.slice(1)}><span className="text-sm text-muted-foreground">Connected</span></SettingsRow>)}
          </SettingsSection>
          {status.hasPassword ? (
            <SettingsSection title="Password">
              <Button variant="floating" onClick={() => navigate("/settings/security/password")}
                className="flex h-auto min-h-12 w-full items-center gap-3 whitespace-normal drawer-floating rounded-full px-5 text-left text-sm font-medium hover:bg-accent">
                <KeyRound className="w-4 h-4 text-muted-foreground" /><span className="flex-1">Reset password with email code</span><ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Button>
              {!open ? (
                <Button variant="floating" onClick={() => setOpen(true)} className="flex h-auto min-h-12 w-full items-center gap-3 whitespace-normal drawer-floating rounded-full px-5 text-left text-sm font-medium hover:bg-accent">
                  <Lock className="w-4 h-4 text-muted-foreground" /><span className="flex-1">Change password</span><ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Button>
              ) : (
                <form onSubmit={submit} className="space-y-2">
                  <input className={field} type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={cur} onChange={(e) => setCur(e.target.value)} required />
                  <input className={field} type="password" autoComplete="new-password" placeholder="New password (8+ characters)" aria-label="New password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
                  <input className={field} type="password" autoComplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password" value={again} onChange={(e) => setAgain(e.target.value)} required />
                  <div className="flex gap-2">
                    <Button variant="floating" type="button" onClick={() => setOpen(false)} className="h-12 flex-1 drawer-floating rounded-full text-sm">Cancel</Button>
                    <Button variant="floating" disabled={busy} className="h-12 flex-1 rounded-full text-sm font-medium text-foreground disabled:opacity-50">{busy ? "Saving…" : "Save"}</Button>
                  </div>
                </form>
              )}
            </SettingsSection>
          ) : (
            <SettingsSection title="Password" description="You sign in with Google or GitHub, so there's no password to manage." />
          )}
        </>
      )}
    </SettingsPage>
  );
}
