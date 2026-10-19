import PageHeader from "@/components/page-header";

const faqs = [
  { q: "What is Vision?", a: "Vision is an AI workspace for everyday questions, deep thinking, research reports with web sources, and writing code." },
  { q: "Do I need an account?", a: "Yes. Sign up with your email, Google or GitHub to start chatting. Privacy Policy, Terms of Service and this FAQ are open to everyone." },
  { q: "How long do I stay signed in?", a: "You stay signed in for 30 days, and that time resets each day you use Vision. You're signed out when you tap Sign out or change your password." },
  { q: "I forgot my password. What now?", a: "On the Log in page, tap “Forgot password”, enter your email and the 8-digit code we send you, then choose a new password." },
  { q: "How do I change my password while signed in?", a: "Open Settings → Security → “Reset password with email code”. You stay signed in on this device." },
  { q: "What does incognito do?", a: "Incognito chats aren't saved to your history. Turn it on or off with the incognito button at the top of the chat." },
  { q: "Can I download or delete my data?", a: "Yes. Settings → Chat & History and Settings → Privacy & Data let you download or delete your chats and reports." },
  { q: "How do I get help?", a: "Open Support from the profile menu to contact us." },
];

const Faq = () => (
  <div className="min-h-[100dvh] bg-background flex flex-col">
    <PageHeader title="FAQ" />
    <div className="flex-1 px-6 pt-2 pb-12 overflow-y-auto">
      <div className="max-w-lg mx-auto">
        {faqs.map((f) => (
          <div key={f.q} className="mb-5">
            <h3 className="text-sm font-display font-semibold text-foreground mb-2">{f.q}</h3>
            <p className="text-sm text-secondary-foreground leading-relaxed">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default Faq;
