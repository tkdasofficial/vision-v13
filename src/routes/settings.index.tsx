import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/")({
  head: () => ({
    meta: [
      { title: "Settings — Vision" },
      { name: "description", content: "Manage your Vision settings by category." },
      { property: "og:title", content: "Settings — Vision" },
      { property: "og:description", content: "Manage your Vision settings by category." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
