import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/security";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/security/")({
  head: () => ({
    meta: [
      { title: "Security — Vision" },
      { name: "description", content: "Password and sign-in security for your Vision account." },
      { property: "og:title", content: "Security — Vision" },
      { property: "og:description", content: "Password and sign-in security for your Vision account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
