import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/terms";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Vision" },
      { name: "description", content: "Terms of Service in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Terms of Service — Vision" },
      { property: "og:description", content: "Terms of Service in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
