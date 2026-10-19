import { createFileRoute, redirect } from "@tanstack/react-router";

// Old address kept working: forwards to /auth/register with the same query string.
export const Route = createFileRoute("/signup")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/auth/register", search: search as never, replace: true });
  },
});
