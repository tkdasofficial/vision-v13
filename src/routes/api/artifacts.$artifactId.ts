import { createFileRoute } from "@tanstack/react-router";

// Owner-only, expiring download of a job artifact (stored privately in Drive or D1).
// The browser fetches this with credentials (see src/lib/download.ts) so the session cookie is always sent.
export const Route = createFileRoute("/api/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { artifactResponse } = await import("@/lib/jobs/artifact-download");
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        const { d1 } = await import("@/lib/cloud/d1.server");
        const { getArtifactBytes } = await import("@/lib/jobs/artifact-store.server");
        return artifactResponse({
          userId: caller?.user.id ?? null,
          id: params.artifactId,
          find: async (id) => (await d1<any>("SELECT * FROM job_artifacts WHERE id = ?", [id]))[0] ?? null,
          read: getArtifactBytes,
          log: (m) => console.error(m),
        });
      },
    },
  },
});
