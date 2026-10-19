import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/SystemSettings";

export const Route = createFileRoute("/admin/system")({
  head: () => ({
    meta: [
      { title: "Admin · System settings — Vision" },
      { name: "description", content: "Admin · System settings in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · System settings — Vision" },
      { property: "og:description", content: "Admin · System settings in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
