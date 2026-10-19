import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/ai";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/ai")({
  head: () => ({
    meta: [
      { title: "AI Preferences — Vision" },
      { name: "description", content: "Default mode, answer style and custom instructions for Vision AI." },
      { property: "og:title", content: "AI Preferences — Vision" },
      { property: "og:description", content: "Default mode, answer style and custom instructions for Vision AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
