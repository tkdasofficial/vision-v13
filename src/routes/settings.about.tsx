import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/about";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/about")({
  head: () => ({
    meta: [
      { title: "About VISION — Vision" },
      { name: "description", content: "Version, help and legal information for Vision." },
      { property: "og:title", content: "About VISION — Vision" },
      { property: "og:description", content: "Version, help and legal information for Vision." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
