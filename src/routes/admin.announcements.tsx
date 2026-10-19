import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/Announcements";

export const Route = createFileRoute("/admin/announcements")({
  head: () => ({
    meta: [
      { title: "Admin · Announcements — Vision" },
      { name: "description", content: "Admin · Announcements in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Announcements — Vision" },
      { property: "og:description", content: "Admin · Announcements in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
