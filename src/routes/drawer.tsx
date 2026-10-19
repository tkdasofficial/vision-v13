import { createFileRoute } from "@tanstack/react-router";
import DrawerPage from "@/pages/drawer";

export const Route = createFileRoute("/drawer")({
  head: () => ({ meta: [
    { title: "Workspace navigation — Vision" },
    { name: "description", content: "Open your recent conversations, library, projects and workspace search in Vision." },
    { property: "og:title", content: "Workspace navigation — Vision" },
    { property: "og:description", content: "Browse your conversations and workspace in Vision." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: DrawerPage,
});
