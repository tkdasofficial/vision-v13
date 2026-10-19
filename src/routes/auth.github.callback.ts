import { createFileRoute } from "@tanstack/react-router";

// /auth/github/callback serves two callers on the merged "vision" Worker:
//   - GitHub itself (code + state) → the gateway's callback handler finishes OAuth
//     and redirects back here with a signed `assertion`.
//   - the gateway's redirect (assertion) → the app's finishOAuth creates the session.
export const Route = createFileRoute("/auth/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!new URL(request.url).searchParams.has("assertion")) {
          const { handleGateway } = await import("@/lib/cloud/gateway.server");
          return handleGateway(request);
        }
        const { finishOAuth } = await import("@/lib/cloud/oauth.server");
        return finishOAuth(request, "github");
      },
    },
  },
});
