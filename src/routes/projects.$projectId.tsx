import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/project-detail";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({ meta: [
    { title: "Project — Vision" },
    { name: "description", content: "Project chats and sources in Vision." },
    { property: "og:title", content: "Project — Vision" },
    { property: "og:description", content: "Project chats and sources in Vision." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: RouteComponent,
});
function RouteComponent() { const { projectId } = Route.useParams(); return <Protected><Page projectId={projectId} /></Protected>; }
