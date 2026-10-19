import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/auth";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => ({
    meta: [
      { title: "Forgot password — Vision" },
      { name: "description", content: "Forgot password in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Forgot password — Vision" },
      { property: "og:description", content: "Forgot password in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
