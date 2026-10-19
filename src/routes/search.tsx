import { createFileRoute } from "@tanstack/react-router";
import Search from "@/pages/search";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [
    { title: "Search chats, files and creations — Vision" },
    { name: "description", content: "Find recent chats, uploaded files, and generated items in your Vision workspace." },
    { property: "og:title", content: "Search your workspace — Vision" },
    { property: "og:description", content: "Find your conversations, uploads, and generated creations in one place." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: SearchPage,
});
function SearchPage() {
  return <Protected><Search /></Protected>;
}
