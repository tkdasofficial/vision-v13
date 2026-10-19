// Private Google Drive storage. Configuration is read only at request time on Cloudflare.
import { d1 } from './d1.server';
import { getSecret } from '../ai/runtime-env.server';
import { driveDestination, driveFolderTree, safeDriveName } from './drive-layout';

const BASE = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
export const DRIVE_MAX_BYTES = 32 * 1024 * 1024; // bounded Worker memory; resumable 4 MiB network writes
export class DriveError extends Error {
  constructor(readonly status: number, action: string) {
    super(status === 401 ? 'Google Drive authorization expired. Renew access in Cloudflare settings.'
      : status === 403 ? 'Google Drive access denied. Check folder permissions and Google API quota.'
      : status === 404 ? 'Google Drive folder or file not found. Check GOOGLE_DRIVE_FOLDER_ID.'
      : `Google Drive ${action} failed (${status}). Please retry.`);
  }
}
function setting(name: string) { const v = getSecret(name); if (!v) throw new Error(`Configure ${name} in Cloudflare Variables and Secrets.`); return v; }
export async function accessToken(): Promise<string> {
  const body = new URLSearchParams({ client_id: setting('GOOGLE_CLIENT_ID'), client_secret: setting('GOOGLE_CLIENT_SECRET'),
    refresh_token: setting('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new DriveError(res.status, 'authorization');
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new DriveError(401, 'authorization');
  return json.access_token;
}
async function driveFetch(token: string, url: string, init: RequestInit = {}, allowConflict = false) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try { res = await fetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) }); }
    catch { if (attempt === 2) throw new Error('Google Drive request timed out. Please retry.'); await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue; }
    if (res.ok || res.status === 308 || (allowConflict && res.status === 409)) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const delay = Math.min(5000, Math.max(500 * 2 ** attempt, Number(res.headers.get('Retry-After') || 0) * 1000));
      await res.body?.cancel(); await new Promise(r => setTimeout(r, delay)); continue;
    }
    await res.body?.cancel(); throw new DriveError(res.status, 'request');
  }
  throw new Error('Google Drive is temporarily unavailable. Please retry.');
}
async function generatedId(token: string) {
  const j = await (await driveFetch(token, `${BASE}/files/generateIds?count=1&space=drive&type=files`)).json() as { ids?: string[] };
  if (!j.ids?.[0]) throw new Error('Google Drive could not reserve a file ID.');
  return j.ids[0];
}
type Registry = { id: string; parent: string; name: string; state: string; format?: string; size?: number; hash?: string; owner?: string; createdAt?: string };
async function readRegistry(key: string): Promise<Registry | null> {
  const rows = await d1<{ value: string }>('SELECT value FROM app_config WHERE key = ?', [key]);
  return rows[0] ? JSON.parse(rows[0].value) : null;
}
// INSERT OR IGNORE selects exactly one reserved Google ID across isolates. Retry creates use that SAME ID.
async function reserve(key: string, candidate: Registry) {
  await d1('INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)', [key, JSON.stringify(candidate)]);
  const row = await readRegistry(key); if (!row) throw new Error('File registry unavailable. No file was delivered.'); return row;
}
async function mark(key: string, record: Registry) {
  await d1('UPDATE app_config SET value = ? WHERE key = ?', [JSON.stringify(record), key]);
}
const quote = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function folderFor(token: string, parent: string, name: string): Promise<string> {
  const key = `drive:v2:folder:${parent}:${name}`;
  let row = await readRegistry(key);
  if (row?.state === 'ready') return row.id;
  if (!row) {
    const q = `'${quote(parent)}' in parents and name='${quote(name)}' and mimeType='${FOLDER}' and trashed=false`;
    const list = await (await driveFetch(token, `${BASE}/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`)).json() as { files?: { id: string }[] };
    row = await reserve(key, { id: list.files?.[0]?.id ?? await generatedId(token), parent, name, state: list.files?.length ? 'ready' : 'reserved' });
  }
  if (row.state !== 'ready') {
    await driveFetch(token, `${BASE}/files?supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, name, mimeType: FOLDER, parents: [parent] }) }, true);
    const meta = await (await driveFetch(token, `${BASE}/files/${encodeURIComponent(row.id)}?fields=id,mimeType,parents,trashed&supportsAllDrives=true`)).json() as { mimeType: string; parents?: string[]; trashed?: boolean };
    if (meta.mimeType !== FOLDER || meta.trashed || !meta.parents?.includes(parent)) throw new Error('Google Drive folder verification failed.');
    await mark(key, { ...row, state: 'ready' });
  }
  return row.id;
}
async function visionRoot(token: string) {
  const root = setting('GOOGLE_DRIVE_FOLDER_ID');
  const meta = await (await driveFetch(token, `${BASE}/files/${encodeURIComponent(root)}?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`)).json() as { mimeType: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean } };
  if (meta.mimeType !== FOLDER || meta.trashed) throw new Error('GOOGLE_DRIVE_FOLDER_ID must identify an accessible folder.');
  if (meta.capabilities?.canAddChildren === false) throw new DriveError(403, 'folder access');
  return folderFor(token, root, 'VISION');
}
/** Explicit, repeatable full initialization; normal writes reconcile their destination lazily. */
export async function initializeDriveStructure() {
  const token = await accessToken(); const root = await visionRoot(token); const folders: Record<string, string> = {};
  for (const [category, formats] of Object.entries(driveFolderTree())) {
    const cat = await folderFor(token, root, category); folders[category] = cat;
    for (const format of formats) folders[`${category}/${format}`] = await folderFor(token, cat, format);
  }
  return { root, folders };
}
async function digest(bytes: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export async function storePrivate(name: string, mime: string, bytes: Uint8Array, identity: string = crypto.randomUUID(), owner = ''): Promise<string> {
  if (bytes.length > DRIVE_MAX_BYTES) throw new Error('This file exceeds the 32 MB safe storage limit. No completed download was created.');
  const token = await accessToken(); const root = await visionRoot(token); const dest = driveDestination(name);
  const category = await folderFor(token, root, dest.category); const parent = await folderFor(token, category, dest.folder);
  const hash = await digest(bytes); const key = `drive:v2:upload:${identity}`;
  const row = await reserve(key, { id: await generatedId(token), parent, name: safeDriveName(name), state: 'reserved', format: dest.format, size: bytes.length, hash, owner, createdAt: new Date().toISOString() });
  if (row.hash !== hash || row.owner !== owner) throw new Error('File retry does not match the original output.');
  if (row.state === 'verified' || row.state === 'indexed') return row.id;
  // A reserved ID makes retries safe even after an interrupted response or metadata write.
  const existing = await fetch(`${BASE}/files/${encodeURIComponent(row.id)}?fields=id,size&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (existing.status !== 404 && !existing.ok) { await existing.body?.cancel(); throw new DriveError(existing.status, 'upload reconciliation'); }
  let complete = false;
  if (existing.ok) { const back = new Uint8Array(await (await readPrivate(row.id)).arrayBuffer()); complete = back.length === bytes.length && await digest(back) === hash; }
  if (!complete) {
    await existing.body?.cancel();
    const uploadTag = await digest(new TextEncoder().encode(identity));
    // An interrupted session can leave a partial file behind. Restart its media on the
    // same reserved ID, not a second file; only our unpublished reservation is mutable.
    const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files${existing.ok ? `/${encodeURIComponent(row.id)}` : ''}?uploadType=resumable&supportsAllDrives=true`;
    const metadata = existing.ok ? { name: row.name, appProperties: { visionUpload: uploadTag } } : { id: row.id, name: row.name, parents: [parent], appProperties: { visionUpload: uploadTag } };
    const start = await driveFetch(token, uploadUrl, { method: existing.ok ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(metadata) }, true);
    if (start.status === 409) throw new Error('Another upload is saving this file. Please retry.');
    const location = start.headers.get('Location');
    if (!location || !location.startsWith('https://www.googleapis.com/')) throw new Error('Google Drive did not provide a safe upload destination.');
    const chunk = 4 * 1024 * 1024;
    for (let offset = 0; offset < Math.max(bytes.length, 1); offset += chunk) {
      const end = Math.min(offset + chunk, bytes.length);
      const res = await driveFetch(token, location, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Range': bytes.length ? `bytes ${offset}-${end - 1}/${bytes.length}` : 'bytes */0' }, body: bytes.subarray(offset, end) as Uint8Array<ArrayBuffer> });
      if (end === bytes.length && res.status === 308) throw new Error('Google Drive upload is incomplete. Please retry.');
      await res.body?.cancel();
    }
    const back = new Uint8Array(await (await readPrivate(row.id)).arrayBuffer());
    if (back.length !== bytes.length || await digest(back) !== hash) throw new Error('Google Drive upload failed integrity verification.');
  }
  await mark(key, { ...row, state: 'verified' });
  return row.id;
}
export async function markDriveIndexed(identity: string) { const key = `drive:v2:upload:${identity}`; const row = await readRegistry(key); if (row) await mark(key, { ...row, state: 'indexed' }); }
export async function readPrivate(id: string): Promise<Response> { return driveFetch(await accessToken(), `${BASE}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`); }
export async function deletePrivate(id: string) {
  try { await driveFetch(await accessToken(), `${BASE}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE' }); } catch (e) { if (!(e instanceof DriveError) || e.status !== 404) throw e; }
  const rows = await d1<{ key: string }>("SELECT key FROM app_config WHERE key LIKE 'drive:v2:upload:%' AND json_extract(value, '$.id') = ?", [id]);
  for (const row of rows) await d1('DELETE FROM app_config WHERE key = ?', [row.key]);
}
// Legacy classification retained for the existing file index filters.
export function kindForMime(mime: string, name: string) { const d = driveDestination(name); return mime.startsWith('image/') ? 'Images' : mime.startsWith('video/') ? 'Videos' : d.format === 'pdf' ? 'PDFs' : d.category === 'Code_and_Development' ? 'Code' : mime.startsWith('text/') ? 'Text' : 'Other'; }
export async function storeFile(userId: string, name: string, mime: string, bytes: Uint8Array, projectId: string | null = null) {
  const safeName = safeDriveName(name); const type = mime || 'application/octet-stream';
  const identity = await digest(new TextEncoder().encode(`${userId}:${projectId ?? ''}:${safeName}:${type}:${await digest(bytes)}`));
  const id = `${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`;
  const driveId = await storePrivate(safeName, type, bytes, `user:${id}`, userId); const url = `/api/files?id=${id}`; const created = new Date().toISOString();
  await d1('INSERT OR IGNORE INTO user_files (id, user_id, name, mime, kind, size, drive_file_id, url, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, userId, safeName, type, kindForMime(type, safeName), bytes.length, driveId, url, projectId, created]);
  await markDriveIndexed(`user:${id}`);
  return { id, name: safeName, mime: type, kind: kindForMime(type, safeName), size: bytes.length, url, project_id: projectId, created_at: created };
}
export async function listFiles(userId: string, projectId?: string | null) {
  const rows = projectId ? await d1<any>('SELECT id, name, mime, kind, size, url, project_id, created_at FROM user_files WHERE user_id = ? AND project_id = ? ORDER BY created_at DESC', [userId, projectId]) : await d1<any>('SELECT id, name, mime, kind, size, url, project_id, created_at FROM user_files WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  return rows.map(row => ({ ...row, url: `/api/files?id=${row.id}` }));
}
export async function deleteFile(userId: string, id: string) {
  const rows = await d1<{ drive_file_id: string }>('SELECT drive_file_id FROM user_files WHERE id = ? AND user_id = ?', [id, userId]);
  if (!rows[0]) throw new Error('File not found'); await deletePrivate(rows[0].drive_file_id); await d1('DELETE FROM user_files WHERE id = ? AND user_id = ?', [id, userId]); return { ok: true };
}
