import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/getting-started";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/getting-started")({
  head: () => ({ meta: [
    { title: "Getting started — Vision" },
    { name: "description", content: "Tell Vision about you and your organization to finish setting up your account." },
    { property: "og:title", content: "Getting started — Vision" },
    { property: "og:description", content: "Tell Vision about you and your organization to finish setting up your account." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: RouteComponent,
});
function RouteComponent() { return <Protected><Page /></Protected>; }
