import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Vision — AI workspace" },
    { name: "description", content: "Start a conversation in your Vision workspace." },
    { property: "og:title", content: "Vision — AI workspace" },
    { property: "og:description", content: "Start a conversation in your Vision workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  beforeLoad: () => { throw redirect({ to: "/chat" }); },
});
