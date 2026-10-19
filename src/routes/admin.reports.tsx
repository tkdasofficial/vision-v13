import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Reports";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Admin · Reports — Vision" },
      { name: "description", content: "Admin · Reports in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Reports — Vision" },
      { property: "og:description", content: "Admin · Reports in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
