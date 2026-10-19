import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import { Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppLogo } from "@/components/app-logo";

// Step 2 of password reset. Only reachable after /auth/verify accepted the code,
// which leaves a short-lived reset ticket in an HttpOnly cookie.
const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<"checking" | "ready" | "expired">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth
      .resetTicketStatus()
      .then((r: { valid: boolean }) => setStatus(r.valid ? "ready" : "expired"))
      .catch(() => setStatus("expired"));
  }, []);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password.length <= 128 && password === confirm;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.completePasswordReset(password);
      if (error) {
        if (/expired/i.test(error.message)) setStatus("expired");
        throw error;
      }
      toast({ title: "Password updated", description: "You're signed in." });
      navigate("/chat");
    } catch (e: any) {
      toast({ title: "Couldn't update password", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const field =
    "w-full pl-11 py-3 rounded-full border border-border bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/30 transition-colors";

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col px-6 py-10 sm:py-14">
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center gap-8">
        <div className="space-y-2">
          <AppLogo className="w-12 h-12 rounded-2xl" />
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground pt-4">
            {status === "expired" ? "Reset link expired" : "Set a new password"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {status === "expired"
              ? "For your security, please verify your email again to continue."
              : "Choose a new password for your account."}
          </p>
        </div>

        {status === "checking" && <p className="text-sm text-muted-foreground">Checking…</p>}

        {status === "expired" && (
          <button
            onClick={() => navigate("/auth/forgot-password")}
            className="w-full py-3 rounded-full bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Request a new code
          </button>
        )}

        {status === "ready" && (
          <div className="space-y-3">
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={show ? "text" : "password"}
                placeholder="New password (min 8 characters)"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${field} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={show ? "text" : "password"}
                placeholder="Confirm new password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className={`${field} pr-4`}
              />
            </div>
            {tooShort && <p className="text-xs text-destructive">Use at least 8 characters.</p>}
            {mismatch && <p className="text-xs text-destructive">Passwords don't match.</p>}
            <button
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="w-full py-3 rounded-full bg-foreground text-background text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              <KeyRound className="h-4 w-4" />
              {loading ? "Updating…" : "Update password & sign in"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
