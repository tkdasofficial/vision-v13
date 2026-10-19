import { createFileRoute } from "@tanstack/react-router";
import EnterpriseLogin from "@/pages/enterprise-login";

export const Route = createFileRoute("/enterprise")({
  head: () => ({ meta: [
    { title: "Enterprise Login — Vision" },
    { name: "description", content: "Sign in to Vision with your organization's verified domain and work email." },
    { property: "og:title", content: "Enterprise Login — Vision" },
    { property: "og:description", content: "Sign in to Vision with your organization's verified domain and work email." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: EnterpriseIdentityPage,
});

function EnterpriseIdentityPage() {
  return <EnterpriseLogin page="identity" />;
}
