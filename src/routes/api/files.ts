import { createFileRoute } from "@tanstack/react-router";

// File storage API: uploads go to the configured Google Drive folder
// (sorted into per-type sub-folders), records live in D1. Sign-in required.
const MAX_BYTES = 25 * 1024 * 1024;

export const Route = createFileRoute("/api/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const id = new URL(request.url).searchParams.get("id");
        if (id) {
          const { d1 } = await import("@/lib/cloud/d1.server");
          const { readPrivate } = await import("@/lib/cloud/drive.server");
          const { contentDisposition } = await import("@/lib/jobs/artifact-download");
          const rows = await d1<any>("SELECT * FROM user_files WHERE id = ? AND user_id = ?", [id, caller.user.id]);
          if (!rows[0]) return Response.json({ error: "File not found." }, { status: 404 });
          try {
            const stored = await readPrivate(rows[0].drive_file_id);
            return new Response(stored.body, { headers: { "Content-Type": rows[0].mime, "Content-Disposition": contentDisposition(rows[0].name), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
          } catch { return Response.json({ error: "Google Drive is unavailable. Please retry." }, { status: 502 }); }
        }
        const { listFiles } = await import("@/lib/cloud/drive.server");
        return Response.json({ files: await listFiles(caller.user.id, new URL(request.url).searchParams.get("project")) });
      },

      POST: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        {
          const { d1Store, factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
          const { enforceLimits, SECURITY_CONFIG } = await import("../../../security");
          try {
            assertSameOrigin(factsFrom(request.headers, null));
            await enforceLimits(d1Store, [[`upload:user:${caller.user.id}`, SECURITY_CONFIG.limits.uploadPerUser]]);
          } catch (e: any) { return Response.json({ error: e.message }, { status: 429 }); }
        }
        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return Response.json({ error: "No file provided." }, { status: 400 });
        if (file.size > MAX_BYTES) return Response.json({ error: "Files up to 25 MB are supported." }, { status: 400 });
        try {
          const { storeFile } = await import("@/lib/cloud/drive.server");
          const project = typeof form?.get("project") === "string" ? String(form.get("project")) : null;
          if (project) {
            const { d1 } = await import("@/lib/cloud/d1.server");
            const own = await d1("SELECT id FROM workspace_projects WHERE id = ? AND user_id = ?", [project, caller.user.id]);
            if (!own.length) return Response.json({ error: "Project not found." }, { status: 404 });
          }
          const record = await storeFile(caller.user.id, file.name, file.type, new Uint8Array(await file.arrayBuffer()), project);
          return Response.json({ file: record });
        } catch (e) {
          const { safeError } = await import("@/lib/jobs/jobs.server");
          return Response.json({ error: safeError(e) }, { status: 502 });
        }
      },

      DELETE: async ({ request }) => {
        const { maybeProxyToWorker } = await import("@/lib/cloud/api-proxy.server");
        const proxied = await maybeProxyToWorker(request);
        if (proxied) return proxied;
        const { getCaller } = await import("@/lib/cloud/auth.server");
        const caller = await getCaller();
        if (!caller) return Response.json({ error: "Please sign in." }, { status: 401 });
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return Response.json({ error: "Missing file id." }, { status: 400 });
        {
          const { factsFrom, assertSameOrigin } = await import("@/lib/cloud/security.server");
          try { assertSameOrigin(factsFrom(request.headers, null)); } catch (e: any) { return Response.json({ error: e.message }, { status: 403 }); }
        }
        try {
          const { deleteFile } = await import("@/lib/cloud/drive.server");
          await deleteFile(caller.user.id, id);
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[files] delete failed", e);
          return Response.json({ error: "Delete failed." }, { status: 500 });
        }
      },
    },
  },
});
