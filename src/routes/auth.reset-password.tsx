import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/reset-password";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Vision" },
      { name: "description", content: "Choose and confirm a new password for your Vision account." },
      { property: "og:title", content: "Set a new password — Vision" },
      { property: "og:description", content: "Choose and confirm a new password for your Vision account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});
