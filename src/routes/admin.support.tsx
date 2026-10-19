import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Support";

export const Route = createFileRoute("/admin/support")({
  head: () => ({
    meta: [
      { title: "Admin · Support inbox — Vision" },
      { name: "description", content: "Admin · Support inbox in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Support inbox — Vision" },
      { property: "og:description", content: "Admin · Support inbox in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
