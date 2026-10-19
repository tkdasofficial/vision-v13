import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { useToast } from "@/hooks/use-toast";
import { Lock, Loader2 } from "lucide-react";
import { ORG_SIZES, ENTERPRISE_ROLES } from "@/lib/onboarding-options";
import { enterpriseProfileFn, enterpriseOnboardFn } from "@/lib/cloud/enterprise.functions";

const field = "w-full px-4 py-2.5 rounded-xl border border-border bg-card text-sm text-foreground outline-none focus:border-foreground/20 transition-colors";

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o}
          className={`px-3.5 py-2 rounded-full border text-sm transition-colors ${value === o ? "bg-foreground text-background border-foreground" : "border-border text-foreground hover:bg-accent"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Locked({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-2">{label}</p>
      <div className="relative">
        <input readOnly aria-readonly="true" value={value} className={`${field} pr-10 bg-muted/40 text-muted-foreground cursor-not-allowed`} />
        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>
    </div>
  );
}

const EnterpriseGettingStarted = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [profile, setProfile] = useState<{ enterpriseName: string; domain: string; onboarded: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ companySize: "", role: "", businessPhone: "", street: "", city: "", region: "", postalCode: "", country: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    enterpriseProfileFn().then((r) => {
      if (!r.data) return navigate("/chat"); // not an enterprise account
      if (r.data.onboarded) return navigate("/chat");
      setProfile(r.data);
    });
  }, []);

  const valid = !!f.companySize && !!f.role && f.businessPhone.replace(/\D/g, "").length >= 7;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const r = await enterpriseOnboardFn({ data: f });
    setSaving(false);
    if (r.error) return toast({ title: "Couldn't save", description: r.error, variant: "destructive" });
    navigate(r.data!.redirect);
  };

  if (!profile)
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Enterprise Login · VISION BDI</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Set up your enterprise account</h1>
        </div>

        <Locked label="Enterprise Name" value={profile.enterpriseName} />
        <Locked label="Enterprise Domain" value={profile.domain} />
        <Locked label="Organization Type" value="Enterprise" />

        <div><p className="text-sm font-medium text-foreground mb-3">Company size</p><Chips options={ORG_SIZES} value={f.companySize} onChange={set("companySize")} /></div>
        <div><p className="text-sm font-medium text-foreground mb-3">Your role</p><Chips options={ENTERPRISE_ROLES} value={f.role} onChange={set("role")} /></div>

        <div>
          <label htmlFor="biz-phone" className="text-sm font-medium text-foreground mb-2 block">Business Phone Number</label>
          <input id="biz-phone" type="tel" className={field} placeholder="+1 555 123 4567" value={f.businessPhone} onChange={(e) => set("businessPhone")(e.target.value)} />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Business Address <span className="text-muted-foreground font-normal">(optional)</span></p>
          <input className={field} placeholder="Street Address" value={f.street} onChange={(e) => set("street")(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className={field} placeholder="City" value={f.city} onChange={(e) => set("city")(e.target.value)} />
            <input className={field} placeholder="State / Region" value={f.region} onChange={(e) => set("region")(e.target.value)} />
            <input className={field} placeholder="Postal Code" value={f.postalCode} onChange={(e) => set("postalCode")(e.target.value)} />
            <input className={field} placeholder="Country" value={f.country} onChange={(e) => set("country")(e.target.value)} />
          </div>
        </div>

        <button onClick={submit} disabled={!valid || saving} className="w-full h-12 rounded-full bg-foreground text-background text-sm font-medium disabled:opacity-40">
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
};

export default EnterpriseGettingStarted;
