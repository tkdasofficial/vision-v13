import { downloadFile, saveBlob } from './download';
import { toast } from 'sonner';

/** Browser exports contain no credentials; authenticated Cloudflare upload precedes download. */
export async function persistExport(blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', new File([blob], name, { type: blob.type || 'application/octet-stream' }));
  const response = await fetch('/api/files', { method: 'POST', credentials: 'include', body: form });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.file?.url) throw new Error(json?.error || 'The file could not be saved to Google Drive. Please retry.');
  return json.file.url;
}
export async function exportToDrive(blob: Blob, name: string): Promise<void> {
  // Incognito must never persist files or other session data.
  if (window.location.pathname === '/chat/incognito') { saveBlob(blob, name); return; }
  try { await downloadFile(await persistExport(blob, name), name); }
  catch (e) { toast.error(e instanceof Error ? e.message : 'The file could not be saved.'); }
}