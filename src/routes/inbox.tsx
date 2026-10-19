import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/inbox";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — Vision" },
      { name: "description", content: "Inbox in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Inbox — Vision" },
      { property: "og:description", content: "Inbox in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
