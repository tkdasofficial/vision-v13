import { useNavigate } from "@/lib/router-compat";
import PageHeader from "@/components/page-header";
import { ArrowLeft, User, Mail, KeyRound, ShieldCheck, Smartphone, Copy, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/cloud/client";
import { useToast } from "@/hooks/use-toast";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

type TwoFAMethod = "none" | "email" | "totp";

const Account = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, user } = useAuth();
  const [name, setName] = useState(profile?.full_name || "");
  const [sub, setSub] = useState<any>(null);
  const [twoFAMethod, setTwoFAMethod] = useState<TwoFAMethod>("none");
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // TOTP enrollment state
  const [totpSetup, setTotpSetup] = useState<{
    qr: string;
    secret: string;
    factorId: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpVerifying, setTotpVerifying] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  useEffect(() => {
    if (profile) setName(profile.full_name || "");
  }, [profile]);

  useEffect(() => {
    if (user) {
      supabase.from("subscriptions").select("*").eq("user_id", user.id).single().then(({ data }) => {
        if (data) setSub(data);
      });
      supabase.from("user_2fa").select("enabled, method").eq("user_id", user.id).maybeSingle().then(({ data }) => {
        if (data && data.enabled) {
          setTwoFAMethod((data as any).method || "email");
        }
      });
    }
  }, [user]);

  const saveName = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: name, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Profile updated" });
    }
  };

  const save2FA = async (method: TwoFAMethod) => {
    if (!user) return;
    const enabled = method !== "none";
    const { data: existing } = await supabase.from("user_2fa").select("id").eq("user_id", user.id).maybeSingle();
    if (existing) {
      await supabase.from("user_2fa").update({ enabled, method, updated_at: new Date().toISOString() } as any).eq("user_id", user.id);
    } else {
      await supabase.from("user_2fa").insert({ user_id: user.id, enabled, method } as any);
    }
    setTwoFAMethod(method);
  };

  const handleEnableEmail = async () => {
    setTwoFALoading(true);
    await save2FA("email");
    setTwoFALoading(false);
    toast({ title: "Email 2FA enabled", description: "You'll receive a code via email on each login." });
  };

  const handleStartTOTP = async () => {
    setTwoFALoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setTotpSetup({
        qr: data.totp.qr_code,
        secret: data.totp.secret,
        factorId: data.id,
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setTwoFALoading(false);
    }
  };

  const handleVerifyTOTP = async () => {
    if (!totpSetup || totpCode.length < 6) return;
    setTotpVerifying(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: totpSetup.factorId });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: totpSetup.factorId,
        challengeId: challenge.id,
        code: totpCode,
      });
      if (vErr) throw vErr;
      await save2FA("totp");
      setTotpSetup(null);
      setTotpCode("");
      toast({ title: "Authenticator app enabled", description: "You'll need the app code on each login." });
    } catch (e: any) {
      toast({ title: "Verification failed", description: e.message, variant: "destructive" });
    } finally {
      setTotpVerifying(false);
    }
  };

  const handleDisable2FA = async () => {
    setTwoFALoading(true);
    // Unenroll TOTP factors if any
    if (twoFAMethod === "totp") {
      const { data } = await supabase.auth.mfa.listFactors();
      if (data?.totp) {
        for (const f of data.totp) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
    }
    await save2FA("none");
    setTwoFALoading(false);
    setTotpSetup(null);
    toast({ title: "2FA disabled" });
  };

  const copySecret = () => {
    if (totpSetup?.secret) {
      navigator.clipboard.writeText(totpSetup.secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <PageHeader title="Account" />

      <div className="flex-1 px-6 pt-2 pb-12 overflow-y-auto">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Profile */}
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight text-foreground mb-4">Profile</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-foreground/10 flex items-center justify-center overflow-hidden">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-7 h-7 text-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{name || "User"}</p>
                  <p className="text-xs text-muted-foreground">{sub?.plan || "free"} plan</p>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Email</label>
                <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">{profile?.email || user?.email || ""}</span>
                </div>
              </div>

              <button onClick={saveName} className="w-full py-3.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity">
                Save changes
              </button>
            </div>
          </section>

          {/* Security lives in Settings → Security */}
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight text-foreground mb-4">Security</h2>
            <button onClick={() => navigate("/settings/security")} className="w-full flex items-center gap-3 rounded-2xl border border-border px-5 py-4 hover:bg-accent transition-colors text-left">
              <ShieldCheck className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Password & sign-in security</p>
                <p className="text-xs text-muted-foreground">Managed in Settings → Security</p>
              </div>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Account;
