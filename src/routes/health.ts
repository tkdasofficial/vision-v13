import { createFileRoute } from "@tanstack/react-router";

// Gateway endpoint: Worker health check.
export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
    },
  },
});
