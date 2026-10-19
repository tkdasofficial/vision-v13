import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/faq";

export const Route = createFileRoute("/help/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — Vision" },
      { name: "description", content: "Answers to common questions about Vision accounts, sign-in, privacy and chat features." },
      { property: "og:title", content: "FAQ — Vision" },
      { property: "og:description", content: "Answers to common questions about Vision accounts, sign-in, privacy and chat features." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
