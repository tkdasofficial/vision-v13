// Owner-only artifact download: pure decision logic shared by /api/artifacts/$artifactId and its tests.
// Each failure gets its own status/code so the browser can explain it (never a blanket 401).

export type ArtifactRecord = { id: string; user_id: string; name: string; mime: string; size: number; sha256: string; drive_file_id: string; kind: string; expires_at: string };
export type DownloadErrorCode = "auth_required" | "invalid_id" | "not_found" | "forbidden" | "expired" | "missing_object" | "storage_unavailable" | "corrupted";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES: Record<DownloadErrorCode, [number, string]> = {
  auth_required: [401, "Your session has ended. Please sign in again to download this file."],
  invalid_id: [404, "This download link is not valid."],
  not_found: [404, "This file does not exist."],
  forbidden: [403, "You don't have access to this file."],
  expired: [410, "This download has expired. Run the task again to get a new file."],
  missing_object: [404, "The stored file could not be found. Run the task again to recreate it."],
  storage_unavailable: [502, "File storage is unavailable right now. Please try again in a moment."],
  corrupted: [500, "The stored file is damaged and was not sent. Run the task again to recreate it."],
};

export function downloadError(code: DownloadErrorCode) {
  const [status, error] = MESSAGES[code];
  return Response.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}

/** RFC 6266 filename: ASCII fallback plus UTF-8 filename* so names and extensions survive. */
export function contentDisposition(name: string) {
  const ascii = name.replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function artifactResponse(o: {
  userId: string | null;
  id: string;
  find: (id: string) => Promise<ArtifactRecord | null>;
  read: (key: string) => Promise<Uint8Array>;
  now?: number;
  log?: (msg: string) => void;
}): Promise<Response> {
  if (!o.userId) return downloadError("auth_required");
  if (!ID_RE.test(o.id)) return downloadError("invalid_id");
  const a = await o.find(o.id);
  if (!a || a.kind === "source") return downloadError("not_found");
  if (a.user_id !== o.userId) return downloadError("forbidden");
  if (Date.parse(a.expires_at) <= (o.now ?? Date.now())) return downloadError("expired");
  let bytes: Uint8Array;
  try { bytes = await o.read(a.drive_file_id); }
  catch (e: any) {
    const msg = String(e?.message ?? e);
    o.log?.(`[artifact] read failed id=${a.id}: ${msg.slice(0, 200)}`);
    return downloadError(/not found|404/i.test(msg) ? "missing_object" : "storage_unavailable");
  }
  if ((a.size > 0 && bytes.length !== a.size) || (a.sha256 && /^[0-9a-f]{64}$/.test(a.sha256) && (await sha256Hex(bytes)) !== a.sha256)) {
    o.log?.(`[artifact] integrity mismatch id=${a.id} size=${bytes.length}/${a.size}`);
    return downloadError("corrupted");
  }
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": a.mime || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(a.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Checksum-SHA256": a.sha256,
    },
  });
}
