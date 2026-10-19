import { createFileRoute } from "@tanstack/react-router";

// Gateway endpoint: starts Google OAuth (redirects to Google).
export const Route = createFileRoute("/auth/google/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
    },
  },
});
