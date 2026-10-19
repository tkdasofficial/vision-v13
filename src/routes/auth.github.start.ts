import { createFileRoute } from "@tanstack/react-router";

// Gateway endpoint: starts GitHub OAuth (redirects to GitHub).
export const Route = createFileRoute("/auth/github/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
    },
  },
});
