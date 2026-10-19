import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/BackgroundTasks";

export const Route = createFileRoute("/admin/background-tasks")({
  head: () => ({
    meta: [
      { title: "Admin · Background tasks — Vision" },
      { name: "description", content: "Admin · Background tasks in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Background tasks — Vision" },
      { property: "og:description", content: "Admin · Background tasks in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
