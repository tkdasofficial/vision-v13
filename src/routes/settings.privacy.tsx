import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/privacy";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & Data — Vision" },
      { name: "description", content: "Download your data and manage research documents." },
      { property: "og:title", content: "Privacy & Data — Vision" },
      { property: "og:description", content: "Download your data and manage research documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
