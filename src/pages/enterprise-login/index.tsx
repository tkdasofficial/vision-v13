import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { Building2, Globe, Mail, ArrowLeft, ShieldCheck, Copy, BadgeCheck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppLogo } from "@/components/app-logo";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  enterpriseStateFn, enterpriseStartFn, enterpriseCheckDomainFn, enterpriseEmailFn, enterpriseResendFn, enterpriseVerifyFn, enterpriseCancelFn,
} from "@/lib/cloud/enterprise.functions";
import { emitAuthRefresh } from "@/lib/cloud/client";

type Page = "identity" | "email" | "verify";
type State = { step: "identity" | "domain" | "email" | "otp"; enterpriseName?: string; domain?: string; txtName?: string; txtValue?: string; email?: string };

const PATH: Record<State["step"], string> = { identity: "/enterprise", domain: "/enterprise", email: "/enterprise/login", otp: "/enterprise/verify" };
const field = "w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/20 transition-colors";
const primary = "w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2";

const EnterpriseLogin = ({ page }: { page: Page }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const apply = (s: State | null) => {
    if (!s) return;
    setState(s);
    const want = PATH[s.step];
    if (want !== window.location.pathname) navigate(want);
  };

  useEffect(() => { enterpriseStateFn().then((r) => apply(r.data as State)); }, [page]);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const call = async <T,>(fn: () => Promise<{ data: T | null; error: string | null }>, onOk: (d: T) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.error) toast({ title: "Enterprise Login", description: r.error, variant: "destructive" });
      else if (r.data) onOk(r.data);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => call(() => enterpriseCancelFn(), () => { setState({ step: "identity" }); navigate("/enterprise"); });

  const header = (title: string, sub: string) => (
    <div className="flex flex-col items-center gap-3">
      <AppLogo className="w-14 h-14 rounded-full" />
      <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground text-center">{sub}</p>
    </div>
  );

  const verified = state && state.step !== "identity" && state.step !== "domain" && (
    <div className="flex items-center gap-2 px-3 py-2 rounded-full border border-border bg-card text-sm">
      <BadgeCheck className="w-4 h-4 text-primary shrink-0" />
      <span className="text-foreground font-medium truncate">{state.enterpriseName}</span>
      <span className="text-muted-foreground truncate">· {state.domain}</span>
      <span className="ml-auto text-xs text-muted-foreground">Verified</span>
    </div>
  );

  let body: React.ReactNode = <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  if (state && (state.step === "identity" || state.step === "domain") && page === "identity") {
    body = (
      <>
        {header("Enterprise Login", "Sign in with your organization's verified domain")}
        {state.step === "identity" ? (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); call(() => enterpriseStartFn({ data: { name, domain } }), (d) => apply(d as State)); }}>
            <label className="sr-only" htmlFor="ent-name">Enterprise Name</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input id="ent-name" required maxLength={120} placeholder="Enterprise Name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
            </div>
            <label className="sr-only" htmlFor="ent-domain">Enterprise Domain</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input id="ent-domain" required maxLength={253} placeholder="Enterprise Domain (example.com)" autoCapitalize="none" value={domain} onChange={(e) => setDomain(e.target.value)} className={field} />
            </div>
            <button type="submit" disabled={busy || !name.trim() || !domain.trim()} className={primary}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Continue
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Prove you control <span className="font-medium text-foreground">{state.domain}</span> by adding this TXT record in your DNS settings, then tap Verify.
            </p>
            {[["Name / Host", state.txtName!], ["Value", state.txtValue!]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border bg-card p-3">
                <div className="text-xs text-muted-foreground mb-1">{k}</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-foreground break-all flex-1">{v}</code>
                  <button type="button" aria-label={`Copy ${k}`} onClick={() => { navigator.clipboard?.writeText(v); toast({ title: "Copied" }); }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <button disabled={busy} onClick={() => call(() => enterpriseCheckDomainFn(), (d) => apply(d as State))} className={primary}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Verify domain
            </button>
            <p className="text-xs text-muted-foreground text-center">DNS changes can take a few minutes to appear.</p>
          </div>
        )}
      </>
    );
  } else if (state?.step === "email" && page === "email") {
    body = (
      <>
        {header("Enterprise Login", "Enter your work email to receive a sign-in code")}
        {verified}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); call(() => enterpriseEmailFn({ data: { email } }), (d) => { setCooldown(30); apply(d as State); }); }}>
          <label className="sr-only" htmlFor="ent-email">Enterprise Email Address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input id="ent-email" type="email" required placeholder={`Enterprise Email Address (you@${state.domain})`} value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
          <button type="submit" disabled={busy || !email.trim()} className={primary}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Continue
          </button>
        </form>
      </>
    );
  } else if (state?.step === "otp" && page === "verify") {
    body = (
      <>
        {header("Check your email", `We sent an 8-digit code to ${state.email}`)}
        {verified}
        <div className="flex justify-center">
          <InputOTP maxLength={8} value={code} onChange={setCode}>
            <InputOTPGroup>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
          </InputOTP>
        </div>
        <button disabled={busy || code.length !== 8} className={primary}
          onClick={() => call(() => enterpriseVerifyFn({ data: { code } }), (d: any) => { emitAuthRefresh(); navigate(d.redirect); })}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Verify & Continue
        </button>
        <div className="text-center">
          <button disabled={busy || cooldown > 0} onClick={() => call(() => enterpriseResendFn(), () => { setCooldown(30); toast({ title: "Code sent", description: "Check your inbox for a new code." }); })}
            className="text-sm text-foreground font-medium hover:underline disabled:opacity-50 disabled:no-underline">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {body}
        <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-4">
          {state && state.step !== "identity" && (
            <button onClick={restart} className="text-foreground font-medium hover:underline">Use a different enterprise</button>
          )}
          <button onClick={() => navigate("/auth/login")} className="flex items-center gap-1 text-foreground font-medium hover:underline">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
};

export default EnterpriseLogin;
