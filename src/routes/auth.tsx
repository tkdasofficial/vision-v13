import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/auth")({
  beforeLoad: ({ location }) => {
    // Only the bare /auth path bounces to /auth/login; child routes like
    // /auth/verify render normally.
    if (location.pathname === "/auth") throw redirect({ to: "/auth/login" });
  },
  component: Outlet,
});
