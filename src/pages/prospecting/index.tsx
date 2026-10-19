import { useEffect, useState } from "react";
import PageHeader from "@/components/page-header";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Radar, Youtube, Globe, Send, Loader2, Trash2, Play, Filter, Mail, CheckCircle2, XCircle, Ban, UserPlus, Clock } from "lucide-react";

type Job = { id: string; source: string; status: string; found_count: number; target_count: number; params: any; error: string | null; created_at: string };
type Lead = {
  id: string; source: string; display_name: string | null; email: string | null;
  channel_url: string | null; primary_domain: string | null;
  subscriber_count: number | null; avg_views: number | null; industry: string | null;
  niche: string | null; status: string; email_status: string | null; created_at: string;
};
type Campaign = { id: string; name: string; pitch_context: string; tone: string; throttle_min_sec: number; throttle_max_sec: number };

export default function Prospecting() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"youtube" | "web">("youtube");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  // YouTube filters
  const [niche, setNiche] = useState("");
  const [minSubs, setMinSubs] = useState(1000);
  const [maxSubs, setMaxSubs] = useState(100000);
  const [minViews, setMinViews] = useState(1000);
  const [maxViews, setMaxViews] = useState(100000);
  const [target, setTarget] = useState(50);

  // Web
  const [webNiche, setWebNiche] = useState("");
  const [webTarget, setWebTarget] = useState(25);

  // Campaign
  // Campaign
  const [campaignId, setCampaignId] = useState<string>("");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignPitch, setNewCampaignPitch] = useState("");

  // Manual email add (user-provided)
  const [manualEmails, setManualEmails] = useState("");
  const [manualName, setManualName] = useState("");

  const load = async () => {
    if (!user) return;
    const [{ data: j }, { data: l }, { data: c }] = await Promise.all([
      supabase.from("prospecting_jobs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("outreach_campaigns").select("*").order("created_at", { ascending: false }),
    ]);
    setJobs((j as Job[]) || []);
    setLeads((l as Lead[]) || []);
    setCampaigns((c as Campaign[]) || []);
    if (c && c.length && !campaignId) setCampaignId(c[0].id);
  };

  useEffect(() => { load(); }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("prospecting-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "prospecting_jobs", filter: `user_id=eq.${user.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const startYouTube = async () => {
    if (!niche.trim()) return toast({ title: "Enter a niche/keyword" });
    setRunning(true);
    const { data: job, error } = await supabase.from("prospecting_jobs").insert({
      user_id: user!.id, source: "youtube", target_count: target,
      params: { niche: niche.trim(), minSubs, maxSubs, minAvgViews: minViews, maxAvgViews: maxViews },
    }).select().single();
    if (error || !job) { setRunning(false); return toast({ title: "Failed to create job", description: error?.message }); }
    supabase.functions.invoke("youtube-prospector", { body: { jobId: job.id } }).then(({ error }) => {
      if (error) toast({ title: "YouTube prospector failed", description: error.message, variant: "destructive" });
    }).finally(() => setRunning(false));
    toast({ title: "Prospecting started", description: "Streaming results below." });
  };

  const startWeb = async () => {
    if (!webNiche.trim()) return toast({ title: "Enter an industry/keyword" });
    setRunning(true);
    const { data: job, error } = await supabase.from("prospecting_jobs").insert({
      user_id: user!.id, source: "web", target_count: webTarget, params: { niche: webNiche.trim() },
    }).select().single();
    if (error || !job) { setRunning(false); return toast({ title: "Failed", description: error?.message }); }
    supabase.functions.invoke("web-prospector", { body: { jobId: job.id } }).then(({ error }) => {
      if (error) toast({ title: "Web prospector failed", description: error.message, variant: "destructive" });
    }).finally(() => setRunning(false));
    toast({ title: "Web discovery started" });
  };

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => s.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)));

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    await supabase.from("leads").delete().in("id", [...selected]);
    setSelected(new Set()); load();
  };

  const createCampaign = async () => {
    if (!newCampaignName.trim() || !newCampaignPitch.trim()) return toast({ title: "Fill campaign fields" });
    const { data, error } = await supabase.from("outreach_campaigns").insert({
      user_id: user!.id, name: newCampaignName.trim(), pitch_context: newCampaignPitch.trim(),
    }).select().single();
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    setCampaignId(data!.id); setNewCampaignName(""); setNewCampaignPitch(""); load();
    toast({ title: "Campaign created" });
  };

  const addManualLeads = async () => {
    const raw = manualEmails.trim();
    if (!raw) return toast({ title: "Paste one or more emails" });
    const emails = [...new Set(raw.split(/[\s,;\n]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(e)))];
    if (emails.length === 0) return toast({ title: "No valid emails found" });
    const rows = emails.map((email) => ({
      user_id: user!.id,
      source: "manual",
      email,
      display_name: manualName.trim() || email.split("@")[0],
      primary_domain: email.split("@")[1],
      status: "new",
    }));
    const { error, data } = await supabase.from("leads").insert(rows).select("id");
    if (error) return toast({ title: "Failed to add", description: error.message, variant: "destructive" });
    toast({ title: `Added ${data?.length || 0} recipient(s)`, description: "Select them below to queue outreach." });
    setManualEmails(""); setManualName(""); load();
  };

  const queueOutreach = async () => {
    if (selected.size === 0) return toast({ title: "Select recipients first" });
    if (!campaignId) return toast({ title: "Create or pick a campaign first" });
    const { data, error } = await supabase.functions.invoke("outreach-composer", {
      body: { leadIds: [...selected], campaignId },
    });
    if (error) return toast({ title: "Queue failed", description: error.message, variant: "destructive" });
    toast({ title: `Queued ${data.queued} personalized emails`, description: "Sending with 45–90s human-like delays." });
    setSelected(new Set());
  };

  const activeJob = jobs.find((j) => j.status === "running" || j.status === "pending");

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto pr-4 flex items-center justify-between">
          <PageHeader title="Client Prospecting" backTo="/chat" />
          {activeJob && (
            <div className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-border bg-card">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{activeJob.source}: {activeJob.found_count}/{activeJob.target_count}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Discovery */}
        <section className="border border-border rounded-xl bg-card">
          <div className="flex border-b border-border">
            <button onClick={() => setTab("youtube")} className={`px-5 py-3 text-sm font-medium flex items-center gap-2 ${tab === "youtube" ? "border-b-2 border-foreground" : "text-muted-foreground"}`}>
              <Youtube className="w-4 h-4" /> YouTube (API v3)
            </button>
            <button onClick={() => setTab("web")} className={`px-5 py-3 text-sm font-medium flex items-center gap-2 ${tab === "web" ? "border-b-2 border-foreground" : "text-muted-foreground"}`}>
              <Globe className="w-4 h-4" /> Web Discovery
            </button>
          </div>

          {tab === "youtube" ? (
            <div className="p-5 grid grid-cols-1 md:grid-cols-6 gap-3">
              <Field className="md:col-span-2" label="Niche / keyword" value={niche} onChange={setNiche} placeholder="e.g. cooking, ai tools, minimalism" />
              <Field label="Min subs" type="number" value={minSubs} onChange={(v: any) => setMinSubs(Number(v))} />
              <Field label="Max subs" type="number" value={maxSubs} onChange={(v: any) => setMaxSubs(Number(v))} />
              <Field label="Min avg views" type="number" value={minViews} onChange={(v: any) => setMinViews(Number(v))} />
              <Field label="Max avg views" type="number" value={maxViews} onChange={(v: any) => setMaxViews(Number(v))} />
              <Field label="Target count" type="number" value={target} onChange={(v: any) => setTarget(Number(v))} />
              <div className="md:col-span-6 flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />Needs your YouTube API key — add it under Integrations → API Keys (provider: youtube).</p>
                <button onClick={startYouTube} disabled={running} className="px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                  <Play className="w-4 h-4" />Run YouTube prospecting
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-3">
              <Field className="md:col-span-2" label="Industry / niche" value={webNiche} onChange={setWebNiche} placeholder="e.g. food companies in Mumbai" />
              <Field label="Target count" type="number" value={webTarget} onChange={(v: any) => setWebTarget(Number(v))} />
              <div className="flex items-end">
                <button onClick={startWeb} disabled={running} className="w-full px-4 py-3 rounded-full bg-foreground text-background text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                  <Play className="w-4 h-4" />Discover companies
                </button>
              </div>
              <p className="md:col-span-4 text-xs text-muted-foreground">Uses Gemini Search Grounding to find real companies, then scrapes their contact/about pages for emails with human-like delays.</p>
            </div>
          )}
        </section>

        {/* Inspection board */}
        <section className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <h2 className="font-display font-semibold">Inspection Board</h2>
              <span className="text-xs text-muted-foreground">{leads.length} leads · {selected.size} selected</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={deleteSelected} disabled={selected.size === 0} className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent disabled:opacity-40 flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" />Delete
              </button>
              <button onClick={queueOutreach} disabled={selected.size === 0} className="px-3 py-1.5 text-xs rounded-full bg-foreground text-background hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />Queue outreach ({selected.size})
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 w-8"><input type="checkbox" checked={selected.size > 0 && selected.size === leads.length} onChange={toggleAll} /></th>
                  <th className="text-left p-3">Source</th>
                  <th className="text-left p-3">Recipient</th>
                  <th className="text-left p-3">Subs / Category</th>
                  <th className="text-left p-3">Avg views</th>
                  <th className="text-left p-3">Email</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">Run a prospecting job — qualified leads stream in here.</td></tr>
                )}
                {leads.map((l) => (
                  <tr key={l.id} className={`border-t border-border ${selected.has(l.id) ? "bg-accent/40" : ""}`}>
                    <td className="p-3"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="p-3">
                      {l.source === "youtube" ? <Youtube className="w-4 h-4 inline mr-1" /> : <Globe className="w-4 h-4 inline mr-1" />}
                      <span className="text-xs uppercase">{l.source}</span>
                    </td>
                    <td className="p-3">
                      <a href={l.channel_url || (l.primary_domain ? `https://${l.primary_domain}` : "#")} target="_blank" rel="noreferrer" className="font-medium hover:underline">{l.display_name || "—"}</a>
                      <div className="text-xs text-muted-foreground">{l.primary_domain || l.niche}</div>
                    </td>
                    <td className="p-3">{l.subscriber_count?.toLocaleString?.() || l.industry || "—"}</td>
                    <td className="p-3">{l.avg_views?.toLocaleString?.() || "—"}</td>
                    <td className="p-3 font-mono text-xs">{l.email}</td>
                    <td className="p-3"><StatusBadge status={l.status} email_status={l.email_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Manual add — user-provided emails */}
        <section className="border border-border rounded-xl bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <UserPlus className="w-4 h-4" />
            <h2 className="font-display font-semibold">Add recipients manually</h2>
            <span className="text-xs text-muted-foreground">Paste any email(s) you want the AI to write to.</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field className="md:col-span-1" label="Name / label (optional)" value={manualName} onChange={setManualName} placeholder="Acme Corp" />
            <div className="md:col-span-2">
              <label className="text-xs text-muted-foreground">Emails (comma / space / newline separated)</label>
              <textarea value={manualEmails} onChange={(e) => setManualEmails(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono"
                placeholder="jane@acme.com, ops@studio.io" />
            </div>
            <div className="flex items-end">
              <button onClick={addManualLeads} className="w-full px-4 py-3 rounded-full bg-foreground text-background text-sm font-medium flex items-center justify-center gap-2">
                <UserPlus className="w-4 h-4" />Add to board
              </button>
            </div>
          </div>
        </section>


        {/* Campaign */}
        <section className="border border-border rounded-xl bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-4 h-4" />
            <h2 className="font-display font-semibold">Outreach Campaign</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground">Active campaign</label>
              <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm">
                <option value="">— select —</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <Field label="New campaign name" value={newCampaignName} onChange={setNewCampaignName} placeholder="Q1 outbound" />
            <div className="md:col-span-1 flex items-end">
              <button onClick={createCampaign} className="w-full px-4 py-2 rounded-full border border-border text-sm hover:bg-accent">Create campaign</button>
            </div>
            <div className="md:col-span-3">
              <label className="text-xs text-muted-foreground">Pitch context (what you're offering, why it fits them)</label>
              <textarea value={newCampaignPitch} onChange={(e) => setNewCampaignPitch(e.target.value)} rows={3} className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border text-sm" placeholder="I edit long-form YouTube videos — retention-focused cuts, clean pacing, thumbnail concepts. I want to help mid-size creators unlock more views per upload." />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Emails send from your connected Gmail (Integrations → Gmail). Human-like 45–90s jitter, auto-stops on reply or bounce.</p>
        </section>
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", className = "" }: any) {
  return (
    <div className={className}>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full border border-border text-sm outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors" />
    </div>
  );
}

function StatusBadge({ status, email_status }: { status: string; email_status: string | null }) {
  if (email_status === "bounced" || status === "bounced")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive"><XCircle className="w-3 h-3" />Bounced</span>;
  if (status === "error")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-destructive/10 text-destructive" title={email_status || ""}><XCircle className="w-3 h-3" />Failed</span>;
  if (status === "replied")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-success/15 text-success"><CheckCircle2 className="w-3 h-3" />Replied</span>;
  if (status === "sent")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-foreground/10 text-foreground"><Mail className="w-3 h-3" />Sent</span>;
  if (status === "sending")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400"><Send className="w-3 h-3 animate-pulse" />Sending…</span>;
  if (status === "processing")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400"><Loader2 className="w-3 h-3 animate-spin" />Processing…</span>;
  if (status === "queued")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"><Clock className="w-3 h-3" />Queued</span>;
  if (status === "cancelled")
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"><Ban className="w-3 h-3" />Stopped</span>;
  return <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">New</span>;
}
