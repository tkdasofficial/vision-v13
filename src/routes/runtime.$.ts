import { createFileRoute } from "@tanstack/react-router";

// Gateway endpoint: runtime relay for GitHub Actions jobs (/runtime/*).
export const Route = createFileRoute("/runtime/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
      POST: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
    },
  },
});
