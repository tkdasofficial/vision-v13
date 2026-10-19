import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/ChatSessions";

export const Route = createFileRoute("/admin/chat-sessions")({
  head: () => ({
    meta: [
      { title: "Admin · Chat sessions — Vision" },
      { name: "description", content: "Admin · Chat sessions in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Chat sessions — Vision" },
      { property: "og:description", content: "Admin · Chat sessions in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
