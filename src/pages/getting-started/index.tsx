import { useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

import { ORG_TYPES as ALL_ORG_TYPES, ORG_SIZES, ROLES } from "@/lib/onboarding-options";

const ORG_TYPES = ALL_ORG_TYPES.filter((t) => t !== "Enterprise");

const STEPS = ["Personal information", "Organization", "Your role"] as const;

const field = "w-full px-4 py-2.5 rounded-xl border border-border bg-card text-sm text-foreground outline-none focus:border-foreground/20 transition-colors";

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`px-3.5 py-2 rounded-full border text-sm transition-colors ${value === o ? "bg-foreground text-background border-foreground" : "border-border text-foreground hover:bg-accent"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

const GettingStarted = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ full_name: "", phone: "", address: "", org_type: "", org_size: "", role: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const valid = [
    f.full_name.trim().length > 1 && f.phone.trim().length >= 6 && f.address.trim().length > 3,
    !!f.org_type && !!f.org_size,
    !!f.role,
  ][step];

  const next = async () => {
    if (!valid) return;
    if (step < STEPS.length - 1) return setStep(step + 1);
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { ...f, onboarded: "true" } });
    setSaving(false);
    if (error) return toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    navigate("/chat");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex gap-1.5 mb-8">
          {STEPS.map((_, i) => <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-foreground" : "bg-border"}`} />)}
        </div>
        <p className="text-xs text-muted-foreground mb-1">Step {step + 1} of {STEPS.length}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground mb-6">{STEPS[step]}</h1>

        {step === 0 && (
          <div className="space-y-3">
            <input className={field} placeholder="Full name" value={f.full_name} onChange={(e) => set("full_name")(e.target.value)} />
            <input className={field} type="tel" placeholder="Phone number" value={f.phone} onChange={(e) => set("phone")(e.target.value)} />
            <textarea className={`${field} min-h-24 resize-none`} placeholder="Full address" value={f.address} onChange={(e) => set("address")(e.target.value)} />
          </div>
        )}
        {step === 1 && (
          <div className="space-y-6">
            <div><p className="text-sm font-medium text-foreground mb-3">Organization type</p><Chips options={ORG_TYPES} value={f.org_type} onChange={set("org_type")} /></div>
            <div><p className="text-sm font-medium text-foreground mb-3">Organization size</p><Chips options={ORG_SIZES} value={f.org_size} onChange={set("org_size")} /></div>
          </div>
        )}
        {step === 2 && <Chips options={ROLES} value={f.role} onChange={set("role")} />}

        <div className="flex items-center gap-3 mt-8">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="h-11 w-11 rounded-full border border-border flex items-center justify-center text-foreground hover:bg-accent" aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <button onClick={next} disabled={!valid || saving}
            className="flex-1 h-11 rounded-full bg-foreground text-background text-sm font-medium disabled:opacity-40">
            {saving ? "Saving…" : step === STEPS.length - 1 ? "Finish" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GettingStarted;
