import { createFileRoute } from "@tanstack/react-router";
import GuidePage from "@/pages/guide";

export const Route = createFileRoute("/guide")({
  head: () => ({ meta: [
    { title: "App Guide — Vision" },
    { name: "description", content: "Learn Vision's chats, AI modes, projects, memory, Library, Plugins, search, gestures and privacy controls." },
    { property: "og:title", content: "App Guide — Vision" },
    { property: "og:description", content: "A practical guide to Vision's features, gestures, accessibility and safe AI use." },
    { property: "og:type", content: "article" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: GuidePage,
});
