import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/account";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account — Vision" },
      { name: "description", content: "Account in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Account — Vision" },
      { property: "og:description", content: "Account in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
