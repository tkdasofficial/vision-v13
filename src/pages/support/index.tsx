import { useNavigate } from "@/lib/router-compat";
import PageHeader from "@/components/page-header";
import { ArrowLeft, MessageSquare, Mail, HelpCircle, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/cloud/client";
import { useAuth } from "@/context/AuthContext";

const Support = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) return;
    if (!user) { navigate("/auth"); return; }
    setSubmitting(true);
    const { error } = await supabase.from("support_tickets").insert({
      user_id: user.id, subject, message, priority, status: "open",
    });
    setSubmitting(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setSubmitted(true);
    toast({ title: "Ticket submitted", description: "Our team will reply within 24 hours." });
  };


  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <PageHeader title="Support" />

      <div className="flex-1 px-6 pt-2 pb-12 overflow-y-auto">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Quick links */}
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight text-foreground mb-4">How can we help?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { icon: HelpCircle, label: "FAQ", desc: "Common questions answered", link: "#" },
                { icon: MessageSquare, label: "Community", desc: "Join our Discord", link: "#" },
                { icon: Mail, label: "Email Us", desc: "support@vision.ai", link: "#" },
                { icon: ExternalLink, label: "Documentation", desc: "Guides & tutorials", link: "#" },
              ].map((item, i) => (
                <button key={i} className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:bg-accent transition-colors text-left">
                  <item.icon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Contact form */}
          <section>
            <h2 className="font-display text-xl font-semibold tracking-tight text-foreground mb-4">Send a message</h2>
            {submitted ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center animate-fade-up">
                <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                  <MessageSquare className="w-5 h-5 text-success" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">Message sent!</p>
                <p className="text-xs text-muted-foreground mb-4">We'll respond within 24 hours.</p>
                <button
                  onClick={() => { setSubmitted(false); setSubject(""); setMessage(""); }}
                  className="text-sm text-foreground underline underline-offset-4 hover:opacity-70"
                >
                  Send another
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Subject</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="What do you need help with?"
                    className="w-full border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Message</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Describe your issue or question..."
                    rows={4}
                    className="w-full border border-border text-sm text-foreground outline-none resize-none px-4 py-3 rounded-2xl bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-border text-sm text-foreground outline-none px-4 py-3 rounded-full bg-transparent placeholder:text-muted-foreground focus:border-foreground/30 transition-colors">
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={!subject.trim() || !message.trim() || submitting}
                  className="w-full py-3.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Send message
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Support;

