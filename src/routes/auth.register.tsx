import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/auth";

export const Route = createFileRoute("/auth/register")({
  head: () => ({
    meta: [
      { title: "Sign up — Vision" },
      { name: "description", content: "Sign up in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Sign up — Vision" },
      { property: "og:description", content: "Sign up in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
