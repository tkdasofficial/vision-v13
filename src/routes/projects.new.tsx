import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/project-create";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/projects/new")({
  head: () => ({ meta: [
    { title: "Create project — Vision" },
    { name: "description", content: "Create a Vision project with a name, category, and optional icon." },
    { property: "og:title", content: "Create project — Vision" },
    { property: "og:description", content: "Create a Vision project with a name, category, and optional icon." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: RouteComponent,
});
function RouteComponent() { return <Protected><Page /></Protected>; }