import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/settings/accessibility";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/settings/accessibility")({
  head: () => ({
    meta: [
      { title: "Accessibility — Vision" },
      { name: "description", content: "Motion, contrast and tap size options in Vision." },
      { property: "og:title", content: "Accessibility — Vision" },
      { property: "og:description", content: "Motion, contrast and tap size options in Vision." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
