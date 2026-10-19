import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/billing-plans";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/billing/plans")({
  head: () => ({
    meta: [
      { title: "Upgrade — Vision" },
      { name: "description", content: "Upgrade in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Upgrade — Vision" },
      { property: "og:description", content: "Upgrade in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
