import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Subscriptions";

export const Route = createFileRoute("/admin/subscriptions")({
  head: () => ({
    meta: [
      { title: "Admin · Subscriptions — Vision" },
      { name: "description", content: "Admin · Subscriptions in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Subscriptions — Vision" },
      { property: "og:description", content: "Admin · Subscriptions in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
