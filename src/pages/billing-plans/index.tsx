import { useEffect, useState } from "react";
import PageHeader from "@/components/page-header";
import { useNavigate } from "@/lib/router-compat";
import { ArrowLeft, Check, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

type PlanRow = {
  plan: string;
  display_name: string;
  price_monthly: number;
  price_yearly: number;
  tagline: string | null;
  features: string[];
  popular: boolean;
  sort_order: number;
};

const FAQ = [
  { q: "Can I cancel anytime?", a: "Yes. You keep access until the end of the billing period and won't be charged again." },
  { q: "Do you offer refunds?", a: "We offer a 7-day money-back guarantee on first purchases." },
  { q: "What is BYOK (Bring Your Own Key)?", a: "All paid plans let you connect your own OpenAI, Anthropic, Gemini, ElevenLabs and 10+ other provider keys to remove platform limits. Images use built-in Lovable AI by default." },
  { q: "Do unused credits roll over?", a: "No — credits reset each billing cycle. Connect your own keys to bypass platform caps entirely." },
  { q: "Can I switch plans?", a: "Upgrade or downgrade anytime from this page; prorated automatically." },
];

const Upgrade = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [plansRes, subRes] = await Promise.all([
        supabase.from("plan_limits").select("*").eq("active", true).order("sort_order"),
        user ? supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setPlans((plansRes.data || []) as any);
      if (subRes.data?.plan) setCurrentPlan(subRes.data.plan);
      setLoading(false);
    };
    load();
  }, [user]);

  const handleSelect = async (planId: string) => {
    if (!user) { navigate("/auth"); return; }
    if (planId === currentPlan) return;
    setUpdating(planId);
    const { error } = await supabase.from("subscriptions").upsert({
      user_id: user.id,
      plan: planId,
      status: "active",
      billing_cycle: billing,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setUpdating(null);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    setCurrentPlan(planId);
    toast({ title: planId === "free" ? "Downgraded to Free" : `Upgraded to ${planId}`, description: "Changes apply immediately. (Mock billing — no charge.)" });
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <PageHeader title="Plans & Pricing" className="sticky top-0 z-20 bg-background/80 backdrop-blur-sm" />

      <div className="px-4 py-10 max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            5 tiers · BYOK on every paid plan
          </div>
          <h2 className="text-3xl md:text-4xl font-display font-semibold text-foreground tracking-tight">Pick the plan that scales with you</h2>
          <p className="text-sm md:text-base text-muted-foreground mt-3 max-w-xl mx-auto">
            Chat, images, video, TTS — all from one workspace. Bring your own API keys on any paid plan to remove every limit.
          </p>

          <div className="inline-flex items-center gap-1 mt-6 p-1 bg-accent rounded-full">
            <button onClick={() => setBilling("monthly")} className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors ${billing === "monthly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>Monthly</button>
            <button onClick={() => setBilling("yearly")} className={`px-4 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 ${billing === "yearly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
              Yearly <span className="text-[10px] px-1.5 py-0.5 bg-primary/15 text-primary rounded-full">−17%</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {plans.map((p) => {
              const isCurrent = p.plan === currentPlan;
              const monthly = billing === "monthly" ? p.price_monthly : (p.price_yearly / 12);
              const yearly = p.price_yearly;
              return (
                <div key={p.plan} className={`relative rounded-2xl p-5 border ${p.popular ? "border-primary bg-primary/[0.03] shadow-lg" : "border-border bg-card"}`}>
                  {p.popular && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-primary text-primary-foreground text-[10px] font-semibold uppercase tracking-wider rounded-full">
                      Most popular
                    </div>
                  )}
                  <h3 className="text-lg font-display font-semibold text-foreground">{p.display_name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 min-h-[2.4em]">{p.tagline}</p>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">${Number(monthly).toFixed(0)}</span>
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 min-h-[1.2em]">
                    {p.price_monthly > 0 && billing === "yearly" ? `Billed $${yearly}/yr` : p.price_monthly === 0 ? "Free forever" : "Billed monthly"}
                  </p>

                  <button
                    onClick={() => handleSelect(p.plan)}
                    disabled={isCurrent || updating === p.plan}
                    className={`w-full mt-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
                      isCurrent ? "bg-accent text-muted-foreground cursor-default"
                        : p.popular ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-foreground text-background hover:opacity-90"
                    }`}
                  >
                    {updating === p.plan ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : isCurrent ? "Current plan" : p.plan === "free" ? "Downgrade" : "Get started"}
                  </button>

                  <ul className="space-y-2 mt-5">
                    {(p.features as string[]).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                        <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" strokeWidth={2.5} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <div className="max-w-2xl mx-auto mt-16">
          <h3 className="text-xl font-display font-semibold text-foreground text-center mb-6">Frequently asked questions</h3>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <details key={i} className="group rounded-xl border border-border bg-card p-4">
                <summary className="cursor-pointer font-medium text-sm text-foreground flex items-center justify-between">
                  {item.q}
                  <span className="text-muted-foreground text-lg group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          All paid plans include BYOK across 14 providers · Cancel anytime · 7-day refund · Built on Lovable Cloud
        </p>
      </div>
    </div>
  );
};

export default Upgrade;
