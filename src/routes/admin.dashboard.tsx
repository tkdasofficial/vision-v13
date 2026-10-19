import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Dashboard";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Admin · Dashboard — Vision" },
      { name: "description", content: "Admin · Dashboard in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Dashboard — Vision" },
      { property: "og:description", content: "Admin · Dashboard in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
