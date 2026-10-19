import { createFileRoute } from "@tanstack/react-router";

// Legacy return path for sign-ins started before the move to /auth/github/callback. Same verified handler.
export const Route = createFileRoute("/github/callback")({
  server: { handlers: { GET: async ({ request }) => {
    const { finishOAuth } = await import("@/lib/cloud/oauth.server");
    return finishOAuth(request, "github");
  } } },
});
