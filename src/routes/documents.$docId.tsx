import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/documents";

// Not wrapped in <Protected>: the view itself asks visitors to sign in and the server enforces ownership.
export const Route = createFileRoute("/documents/$docId")({
  head: () => ({
    meta: [
      { title: "Research report — Vision" },
      { name: "description", content: "A research report created in Vision." },
      { property: "og:title", content: "Research report — Vision" },
      { property: "og:description", content: "A research report created in Vision." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
