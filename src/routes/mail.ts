import { createFileRoute } from "@tanstack/react-router";

// Gateway endpoint: transactional email via the Worker's SMTP bindings.
export const Route = createFileRoute("/mail")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleGateway } = await import("@/lib/cloud/gateway.server");
        return handleGateway(request);
      },
    },
  },
});
