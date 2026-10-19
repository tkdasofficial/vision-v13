import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/appearance";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/appearance")({
  head: () => ({
    meta: [
      { title: "Appearance — Vision" },
      { name: "description", content: "Theme, accent colour and text size in Vision." },
      { property: "og:title", content: "Appearance — Vision" },
      { property: "og:description", content: "Theme, accent colour and text size in Vision." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
