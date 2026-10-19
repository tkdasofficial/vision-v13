import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Notifications";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({
    meta: [
      { title: "Admin · Notifications — Vision" },
      { name: "description", content: "Admin · Notifications in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Notifications — Vision" },
      { property: "og:description", content: "Admin · Notifications in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
