import { useNavigate } from "@/lib/router-compat";
import PageHeader from "@/components/page-header";
import { ArrowLeft } from "lucide-react";

const Terms = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <PageHeader title="Terms of Service" />

      <div className="flex-1 px-6 pt-2 pb-12 overflow-y-auto">
        <div className="max-w-lg mx-auto prose-sm">
          <p className="text-sm text-muted-foreground mb-4">Last updated: March 6, 2026</p>

          {[
            { title: "1. Acceptance of Terms", content: "By accessing and using Vision, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to these terms, please do not use our service." },
            { title: "2. Description of Service", content: "Vision is an AI-powered productivity platform designed to help creators, marketers, developers, and businesses generate high-quality content through a chat-based interface. The platform uses multiple specialized AI workers to produce professional-grade results." },
            { title: "3. User Accounts", content: "You must create an account to use certain features. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You must be at least 13 years old to use this service." },
            { title: "4. Content Ownership", content: "You retain ownership of all content you create using Vision. We do not claim any intellectual property rights over your generated content. However, you grant us a license to process your inputs for the purpose of providing the service." },
            { title: "5. Acceptable Use", content: "You agree not to use Vision to generate content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable. We reserve the right to suspend accounts that violate these guidelines." },
            { title: "6. Limitation of Liability", content: "Vision is provided \"as is\" without warranties of any kind. We are not liable for any indirect, incidental, special, or consequential damages resulting from your use of the service." },
            { title: "7. Changes to Terms", content: "We reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms." },
          ].map((section, i) => (
            <div key={i} className="mb-5">
              <h3 className="text-sm font-display font-semibold text-foreground mb-2">{section.title}</h3>
              <p className="text-sm text-secondary-foreground leading-relaxed">{section.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Terms;
