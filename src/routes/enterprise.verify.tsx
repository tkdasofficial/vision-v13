import { createFileRoute } from "@tanstack/react-router";
import EnterpriseLogin from "@/pages/enterprise-login";

export const Route = createFileRoute("/enterprise/verify")({
  head: () => ({ meta: [
    { title: "Verify your code — Vision" },
    { name: "description", content: "Enter the 8-digit code sent to your work email to finish Enterprise Login." },
    { property: "og:title", content: "Verify your code — Vision" },
    { property: "og:description", content: "Enter the 8-digit code sent to your work email to finish Enterprise Login." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: EnterpriseVerifyPage,
});

function EnterpriseVerifyPage() {
  return <EnterpriseLogin page="verify" />;
}
