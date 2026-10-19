import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/support";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — Vision" },
      { name: "description", content: "Support in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Support — Vision" },
      { property: "og:description", content: "Support in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
