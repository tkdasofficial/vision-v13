// Browser download of a private server file. A plain <a href download> lets the browser's download
// manager make the request, which (inside the embedded preview / with partitioned cookies) often goes out
// without the session cookie → 401 → Chrome shows "Failed – Needs authorization". Fetching from the page
// always sends the session, lets us check the reply really is the file, and explains failures.

export class DownloadError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

const FALLBACK: Record<number, string> = {
  401: "Your session has ended. Please sign in again to download this file.",
  403: "You don't have access to this file.",
  404: "This file does not exist.",
  410: "This download has expired.",
};

export async function fetchDownload(url: string, fetcher: typeof fetch = fetch): Promise<Blob> {
  let res: Response;
  try { res = await fetcher(url, { credentials: "include", cache: "no-store" }); }
  catch { throw new DownloadError("Network problem — the download couldn't start. Check your connection and try again.", 0, "network"); }
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.ok) {
    const body: any = type.includes("json") ? await res.json().catch(() => null) : null;
    throw new DownloadError(body?.error || FALLBACK[res.status] || "The file couldn't be downloaded right now.", res.status, body?.code || "http");
  }
  const attachment = /attachment/i.test(res.headers.get('Content-Disposition') ?? '');
  if (/text\/html/i.test(type) && !/\.html?$/i.test(url) && !attachment) throw new DownloadError("The server sent a page instead of the file. Please try again.", res.status, "invalid_response");
  let blob: Blob;
  try { blob = await res.blob(); }
  catch { throw new DownloadError("The download was interrupted. Please try again.", res.status, "network"); }
  const expected = Number(res.headers.get("Content-Length") ?? "");
  if (Number.isFinite(expected) && expected > 0 && blob.size !== expected) throw new DownloadError("The download was incomplete. Please try again.", res.status, "incomplete");
  return blob;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadFile(url: string, filename: string) {
  saveBlob(await fetchDownload(url), filename);
}
