import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/language";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/language")({
  head: () => ({
    meta: [
      { title: "Language — Vision" },
      { name: "description", content: "Choose the Vision interface language." },
      { property: "og:title", content: "Language — Vision" },
      { property: "og:description", content: "Choose the Vision interface language." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
