import { createFileRoute, redirect } from "@tanstack/react-router";

// Old reset address: the reset flow now starts at /auth/forgot-password.
export const Route = createFileRoute("/reset-password")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/forgot-password", replace: true });
  },
});
