import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Users";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Admin · Users — Vision" },
      { name: "description", content: "Admin · Users in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Users — Vision" },
      { property: "og:description", content: "Admin · Users in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
