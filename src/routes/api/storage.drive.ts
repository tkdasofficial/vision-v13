import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/storage/drive')({
  server: { handlers: { POST: async ({ request }) => {
    const { maybeProxyToWorker } = await import('@/lib/cloud/api-proxy.server');
    const proxied = await maybeProxyToWorker(request); if (proxied) return proxied;
    const { getCaller } = await import('@/lib/cloud/auth.server');
    const caller = await getCaller();
    if (!caller?.isAdmin) return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    const { assertSameOrigin, factsFrom } = await import('@/lib/cloud/security.server');
    try { assertSameOrigin(factsFrom(request.headers, null)); } catch { return Response.json({ error: 'Request origin not permitted.' }, { status: 403 }); }
    const body = await request.json().catch(() => null);
    try {
      if (body?.operation === 'initialize') {
        const { initializeDriveStructure } = await import('@/lib/cloud/drive.server');
        const result = await initializeDriveStructure();
        return Response.json({ initialized: true, folderCount: Object.keys(result.folders).length });
      }
      if (body?.operation === 'migrate') {
        const { migrateLegacyArtifacts } = await import('@/lib/cloud/drive-migration.server');
        return Response.json(await migrateLegacyArtifacts());
      }
      return Response.json({ error: 'Choose initialize or migrate.' }, { status: 400 });
    } catch (e) {
      const { safeError } = await import('@/lib/jobs/jobs.server');
      return Response.json({ error: safeError(e) }, { status: 502 });
    }
  } } },
});