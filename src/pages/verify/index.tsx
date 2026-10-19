import { useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import { Mail, ArrowLeft, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppLogo } from "@/components/app-logo";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const VerifyEmail = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const email = params.get("email") ?? "";
  const [code, setCode] = useState("");
  const isReset = params.get("mode") === "reset";
  const canSubmit = code.length === 8;
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleVerify = async () => {
    if (!canSubmit || !email) return;
    setLoading(true);
    try {
      if (isReset) {
        const { error } = await supabase.auth.verifyResetCode(email, code);
        if (error) throw error;
        navigate("/auth/reset-password");
        return;
      }
      const { error } = await supabase.auth.verifyEmailCode(email, code);
      if (error) throw error;
      toast({ title: "Email verified", description: "Welcome to Vision!" });
      navigate("/getting-started");
    } catch (e: any) {
      toast({ title: "Invalid code", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      const { error } = isReset
        ? await supabase.auth.resetPasswordForEmail(email)
        : await supabase.auth.resendVerificationCode(email);
      if (error) throw error;
      toast({ title: "Code sent", description: "Check your inbox for a new code." });
    } catch (e: any) {
      toast({ title: "Couldn't resend", description: e.message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col px-6 py-10 sm:py-14">
      <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center gap-8">
        <div className="space-y-2">
          <AppLogo className="w-12 h-12 rounded-2xl" />
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground pt-4">{isReset ? "Enter your code" : "Verify your email"}</h1>
          <p className="text-sm text-muted-foreground">
            We sent an 8-digit code to <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>

        <div className="space-y-5">
          <div className="flex justify-center" data-testid="otp-input">
            <InputOTP maxLength={8} value={code} onChange={setCode}>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          <button
            onClick={handleVerify}
            disabled={loading || !canSubmit}
            className="w-full py-3 rounded-full bg-foreground text-background text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <ShieldCheck className="h-4 w-4" />
            {loading ? "Verifying…" : isReset ? "Verify code" : "Verify email"}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              onClick={() => navigate("/auth/login")}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </button>
            <button
              onClick={handleResend}
              disabled={resending}
              className="text-foreground font-medium hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              <Mail className="h-3.5 w-3.5" /> {resending ? "Sending…" : "Resend code"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
