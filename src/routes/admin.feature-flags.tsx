import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/FeatureFlags";

export const Route = createFileRoute("/admin/feature-flags")({
  head: () => ({
    meta: [
      { title: "Admin · Feature flags — Vision" },
      { name: "description", content: "Admin · Feature flags in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Feature flags — Vision" },
      { property: "og:description", content: "Admin · Feature flags in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
