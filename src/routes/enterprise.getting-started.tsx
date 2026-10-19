import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/enterprise-getting-started";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/enterprise/getting-started")({
  head: () => ({ meta: [
    { title: "Enterprise setup — Vision" },
    { name: "description", content: "Finish setting up your Vision enterprise account." },
    { property: "og:title", content: "Enterprise setup — Vision" },
    { property: "og:description", content: "Finish setting up your Vision enterprise account." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: RouteComponent,
});
function RouteComponent() { return <Protected><Page /></Protected>; }
