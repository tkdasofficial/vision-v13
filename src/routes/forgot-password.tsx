import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address kept working: forwards to /auth/forgot-password with the same query string.
export const Route = createFileRoute("/forgot-password")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/auth/forgot-password", search: search as never, replace: true });
  },
});
