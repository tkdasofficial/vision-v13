import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsPage } from "@/components/settings/settings-ui";
import { Mail, Eye, EyeOff, Check, Loader2 } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { securityStatusFn } from "@/lib/cloud/account-security.functions";
import { requestPasswordResetFn, verifyResetCodeFn, completePasswordResetFn } from "@/lib/cloud/auth.functions";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { AppLogo } from "@/components/app-logo";
import { cn } from "@/lib/utils";

type Step = "send" | "code" | "password";
const STEPS: { id: Step; label: string }[] = [{ id: "send", label: "Email" }, { id: "code", label: "Code" }, { id: "password", label: "Password" }];
const field = "h-12 w-full drawer-floating rounded-full px-5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";
const primary = "h-auto min-h-12 w-full rounded-full text-sm font-medium text-foreground transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2";

const mask = (e: string) => { const [u, d] = e.split("@"); return u && d ? `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d}` : e; };

/** Signed-in password reset: email code → new password, without signing this device out. */
export default function ResetPasswordCode() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("send");
  const [code, setCode] = useState(""); const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => { securityStatusFn().then((s) => setEmail(s.email)).catch(() => toast.error("Couldn't load your account.")); }, []);
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown((c) => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);

  const send = async () => {
    if (!email) return;
    setBusy(true);
    try {
      const r = await requestPasswordResetFn({ data: { email } });
      if (r.error) toast.error(r.error); else { toast.success("Code sent to your email."); setStep("code"); setCode(""); setCooldown(60); }
    } catch { toast.error("Couldn't send the code."); }
    setBusy(false);
  };
  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!email || code.length !== 8) return;
    setBusy(true);
    try {
      const r = await verifyResetCodeFn({ data: { email, code } });
      if (r.error) toast.error(r.error); else setStep("password");
    } catch { toast.error("Couldn't check the code."); }
    setBusy(false);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return toast.error("Passwords don't match.");
    setBusy(true);
    try {
      const r = await completePasswordResetFn({ data: { password: pw } });
      if (r.error) { toast.error(r.error); setBusy(false); return; }
      toast.success("Password changed.");
      navigate("/chat");
    } catch { toast.error("Couldn't change the password."); setBusy(false); }
  };

  const idx = STEPS.findIndex((s) => s.id === step);
  const checks = [{ ok: pw.length >= 8, label: "8+ characters" }, { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), label: "Letters & numbers" }, { ok: !!pw && pw === pw2, label: "Passwords match" }];
  const title = step === "send" ? "Reset password" : step === "code" ? "Check your email" : "New password";
  const sub = step === "send" ? "We'll send a one-time code to your email. You stay signed in on this device."
    : step === "code" ? `Enter the 8-digit code sent to ${email ? mask(email) : "your email"}.`
    : "Choose a strong password you don't use anywhere else.";

  return (
    <SettingsPage title="Reset password">

      <div className="w-full max-w-sm mx-auto flex flex-col gap-7 px-1 pt-4 pb-10 sm:px-6">
        <div className="space-y-2">
          <AppLogo className="w-12 h-12 rounded-2xl" />
          <h2 className="font-display text-2xl font-semibold text-foreground pt-4">{title}</h2>
          <p className="text-sm text-muted-foreground">{sub}</p>
        </div>

        <ol className="flex items-center gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              <span className={cn("w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-medium border",
                i < idx ? "bg-primary text-primary-foreground border-primary" : i === idx ? "border-foreground text-foreground" : "border-border text-muted-foreground")}>
                {i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className={cn("text-xs", i <= idx ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1", i < idx ? "bg-primary" : "bg-border")} />}
            </li>
          ))}
        </ol>

        {!email ? <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div> : (
          <>
            {step === "send" && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 drawer-floating rounded-full px-5 h-12">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0 truncate text-sm text-foreground">{email}</span>
                </div>
                <Button variant="floating" onClick={send} disabled={busy} className={primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? "Sending…" : "Send code"}</Button>
              </div>
            )}

            {step === "code" && (
              <form onSubmit={verify} className="space-y-4">
                <div className="flex justify-center">
                  <InputOTP maxLength={8} value={code} onChange={(v) => setCode(v.replace(/\D/g, ""))} autoFocus>
                    <InputOTPGroup className="min-w-0 w-full">{Array.from({ length: 8 }, (_, i) => <InputOTPSlot key={i} index={i} className="min-w-0 w-9 flex-1 h-11" />)}</InputOTPGroup>
                  </InputOTP>
                </div>
                <Button variant="floating" disabled={busy || code.length !== 8} className={primary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? "Checking…" : "Confirm code"}</Button>
                <p className="text-center text-sm text-muted-foreground">
                  Didn't get it?{" "}
                  <Button variant="floating" type="button" onClick={send} disabled={busy || cooldown > 0} className="mt-2 rounded-full font-medium text-foreground disabled:text-muted-foreground">
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </Button>
                </p>
              </form>
            )}

            {step === "password" && (
              <form onSubmit={save} className="space-y-3">
                <div className="relative">
                  <input className={`${field} pr-12`} type={show ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} placeholder="New password" aria-label="New password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
                  <Button variant="floating" type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} size="icon" className="absolute right-2 top-1/2 size-9 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <input className={field} type={show ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={128} placeholder="Confirm password" aria-label="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
                <ul className="flex flex-wrap gap-2 pt-1">
                  {checks.map((c) => (
                    <li key={c.label} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs", c.ok ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")}>
                      <Check className={cn("w-3 h-3", !c.ok && "opacity-30")} />{c.label}
                    </li>
                  ))}
                </ul>
                <Button variant="floating" disabled={busy || pw.length < 8 || pw !== pw2} className={`${primary} mt-2`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? "Saving…" : "Change password"}</Button>
              </form>
            )}
          </>
        )}
      </div>
    </SettingsPage>
  );
}
