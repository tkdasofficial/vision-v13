import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/memory";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/memory")({
  head: () => ({
    meta: [
      { title: "Memory — Vision" },
      { name: "description", content: "Review, edit and delete what VISION remembers about you." },
      { property: "og:title", content: "Memory — Vision" },
      { property: "og:description", content: "Review, edit and delete what VISION remembers about you." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
