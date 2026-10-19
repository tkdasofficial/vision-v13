import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/AuditLog";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({
    meta: [
      { title: "Admin · Audit log — Vision" },
      { name: "description", content: "Admin · Audit log in Vision, your all-in-one AI workspace." },
      { property: "og:title", content: "Admin · Audit log — Vision" },
      { property: "og:description", content: "Admin · Audit log in Vision, your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <Page />;
}
