import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/prospecting";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/prospecting")({
  head: () => ({
    meta: [
      { title: "Prospecting — Vision" },
      { name: "description", content: "Prospecting in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Prospecting — Vision" },
      { property: "og:description", content: "Prospecting in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
