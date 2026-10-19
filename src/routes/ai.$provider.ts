import { createFileRoute } from "@tanstack/react-router";

// Gateway endpoint: AI relay (nvidia/groq/cf/run) using the Worker's own keys.
export const Route = createFileRoute("/ai/$provider")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
    },
  },
});
