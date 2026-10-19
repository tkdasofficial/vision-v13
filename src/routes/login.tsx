import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address kept working: forwards to /auth/login with the same query string.
export const Route = createFileRoute("/login")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/auth/login", search: search as never, replace: true });
  },
});
