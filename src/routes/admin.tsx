import { createFileRoute } from "@tanstack/react-router";
import Page from "@/views/admin/AdminLayout";
import { Protected } from "@/components/protected";

export const Route = createFileRoute("/admin")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Protected><Page /></Protected>;
}
