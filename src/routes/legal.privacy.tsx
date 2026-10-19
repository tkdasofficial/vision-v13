import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/privacy";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy — Vision" },
      { name: "description", content: "Privacy policy in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Privacy policy — Vision" },
      { property: "og:description", content: "Privacy policy in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
