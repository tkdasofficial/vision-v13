import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { captureWorkerEnv } from '@/lib/ai/runtime-env.server';
import { DRIVE_OUTPUTS, driveDestination, driveFolderTree, safeDriveName } from '@/lib/cloud/drive-layout';
import { FORMATS } from '@/lib/formats/inventory';
import { RUNTIME_OPS } from '@/lib/runtime/operations';
const db = vi.hoisted(() => ({ rows: new Map<string, string>(), fail: false }));
vi.mock('@/lib/cloud/d1.server', () => ({ d1: vi.fn(async (sql: string, args: any[]) => {
  if (db.fail) throw new Error('D1 unavailable');
  if (sql.startsWith('SELECT value')) return db.rows.has(args[0]) ? [{ value: db.rows.get(args[0]) }] : [];
  if (sql.startsWith('INSERT OR IGNORE INTO app_config')) { if (!db.rows.has(args[0])) db.rows.set(args[0], args[1]); }
  if (sql.startsWith('UPDATE app_config')) db.rows.set(args[1], args[0]);
  return [];
}) }));
import { accessToken, initializeDriveStructure, storePrivate, DRIVE_MAX_BYTES, markDriveIndexed, storeFile } from '@/lib/cloud/drive.server';
let files: Map<string, any>; let contents: Map<string, Uint8Array>; let sessions: Map<string, string>; let sequence: number; let requests: { url: string; method: string; body: any }[];
function googleMock() {
  return vi.fn(async (input: any, init: any = {}) => {
    const url = String(input); const method = init.method || 'GET'; requests.push({ url, method, body: init.body });
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'mock-token' });
    if (url.includes('generateIds')) return Response.json({ ids: [`id${++sequence}`] });
    if (url.includes('uploadType=resumable')) { const meta = JSON.parse(init.body); const id = meta.id || new URL(url).pathname.split('/').pop(); const location = `https://www.googleapis.com/session/${id}`; files.set(id, { ...files.get(id), ...meta, id }); sessions.set(location, id); contents.set(id, new Uint8Array()); return new Response(null, { headers: { Location: location } }); }
    if (sessions.has(url)) {
      const id = sessions.get(url) || ''; const previous = contents.get(id) ?? new Uint8Array(); const chunk = new Uint8Array(init.body); const all = new Uint8Array(previous.length + chunk.length); all.set(previous); all.set(chunk, previous.length); contents.set(id, all);
      const range = String(init.headers['Content-Range']); const total = Number(range.split('/').pop());
      return all.length < total ? new Response(null, { status:308 }) : Response.json({ id });
    }
    const u = new URL(url); const id = u.pathname.split('/').pop() || '';
    if (id === 'files' && method === 'POST') { const meta = JSON.parse(init.body); if (files.has(meta.id)) return new Response(null, { status: 409 }); files.set(meta.id, meta); return Response.json(meta); }
    if (id === 'files') { const q = u.searchParams.get('q') || ''; const parent = q.match(/^'([^']+)'/)?.[1]; const name = q.match(/name='([^']+)'/)?.[1]; return Response.json({ files: [...files.values()].filter(f => f.parents?.includes(parent) && f.name === name).map(f => ({ id: f.id })) }); }
    if (!files.has(id)) return new Response(null, { status: 404 });
    if (u.searchParams.get('alt') === 'media') return new Response(contents.get(id) as any);
    return Response.json({ ...files.get(id), size: contents.get(id)?.length });
  });
}
beforeEach(() => {
  db.rows.clear(); db.fail = false; requests = []; sequence = 0; sessions = new Map(); contents = new Map(); files = new Map([['root', { id: 'root', mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true } }]]);
  captureWorkerEnv({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'client-secret', GOOGLE_REFRESH_TOKEN: 'refresh', GOOGLE_DRIVE_FOLDER_ID: 'root' });
  vi.stubGlobal('fetch', googleMock());
});
afterEach(() => { captureWorkerEnv({}); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('canonical output folders', () => {
  it.each([['a.jpg','jpeg'],['a.jpeg','jpeg'],['a.yml','yaml'],['a.db','sqlite'],['a.sqlite','sqlite'],['a.tar.gz','tgz']])('%s uses %s', (name, format) => expect(driveDestination(name).format).toBe(format));
  it('covers every actual writer target and excludes source-only formats', () => {
    const ids = DRIVE_OUTPUTS.map(f => f.id);
    for (const f of FORMATS) { if (f.create) expect(ids).toContain(f.id); for (const target of [...f.inline, ...(f.runtime?.targets ?? [])]) expect(ids).toContain(target); }
    for (const op of Object.values(RUNTIME_OPS)) for (const target of op.targets ?? []) expect(ids).toContain(target);
    for (const id of ['heic', 'rar', 'cbr', 'drawio', 'dxf', 'shp']) expect(ids).not.toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('strips traversal and control characters', () => expect(safeDriveName('../../evil\n.txt')).toBe('evil_.txt'));
});
describe('Cloudflare configuration and safe authorization', () => {
  it('uses existing Worker secrets rather than stale hosting values', async () => {
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'wrong'); await accessToken();
    const body = requests[0].body as URLSearchParams; expect(body.get('refresh_token')).toBe('refresh'); expect(body.get('client_id')).toBe('client');
  });
  it('fails clearly when refresh token is missing', async () => { captureWorkerEnv({}); await expect(accessToken()).rejects.toThrow('GOOGLE_CLIENT_ID'); expect(requests).toHaveLength(0); });
  it.each([401,403])('does not reveal Google error bodies on %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private provider details', { status })));
    await expect(accessToken()).rejects.toThrow(status === 401 ? 'authorization expired' : 'access denied');
    try { await accessToken(); } catch (e) { expect(String(e)).not.toContain('private provider details'); }
  });
});
describe('folder initialization', () => {
  it('initializes the full reconciled tree and reuses it on a repeated run', async () => {
    const a = await initializeDriveStructure(); const count = files.size; const b = await initializeDriveStructure(); expect(a).toEqual(b); expect(files.size).toBe(count);
    expect(Object.keys(a.folders).length).toBe(Object.values(driveFolderTree()).reduce((n, formats) => n + 1 + formats.length, 0));
  });
  it('reuses an existing VISION folder without changing its content', async () => {
    files.set('existing', { id: 'existing', name: 'VISION', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
    expect((await initializeDriveStructure()).root).toBe('existing');
    expect(requests.some(r => r.method === 'DELETE' || r.method === 'PATCH')).toBe(false);
  });
  it('concurrent initialization reserves one remote ID per folder', async () => {
    await Promise.all([initializeDriveStructure(), initializeDriveStructure()]);
    const names = [...files.values()].filter(f => f.parents).map(f => `${f.parents[0]}:${f.name}`); expect(new Set(names).size).toBe(names.length);
  });
  it('rejects an invalid or non-writable root', async () => {
    files.get('root').capabilities.canAddChildren = false; await expect(initializeDriveStructure()).rejects.toThrow('access denied');
    files.delete('root'); await expect(initializeDriveStructure()).rejects.toThrow('not found');
  });
});
describe('private upload, verification and recovery', () => {
  const bytes = new TextEncoder().encode('Exact text');
  it('uploads once, verifies bytes, and keeps reliable format/folder metadata', async () => {
    const id = await storePrivate('story.txt', 'text/plain', bytes, 'task-output', 'u1');
    expect(Array.from(contents.get(id) ?? [])).toEqual(Array.from(bytes)); expect(files.get(id).parents).toHaveLength(1);
    await storePrivate('story.txt', 'text/plain', bytes, 'task-output', 'u1');
    expect(requests.filter(r => r.url.includes('uploadType=resumable'))).toHaveLength(1);
    await markDriveIndexed('task-output'); expect(JSON.parse(db.rows.get('drive:v2:upload:task-output') || '{}')).toMatchObject({ state: 'indexed', format: 'txt', owner: 'u1', size: bytes.length });
    expect(requests.some(r => r.url.includes('/permissions'))).toBe(false);
  });
  it('reconciles an uploaded file after the registry confirmation was interrupted', async () => {
    const id = await storePrivate('a.txt','text/plain',bytes,'stable','u1'); const key = 'drive:v2:upload:stable'; const row = JSON.parse(db.rows.get(key) || '{}'); row.state = 'reserved'; db.rows.set(key, JSON.stringify(row));
    expect(await storePrivate('a.txt','text/plain',bytes,'stable','u1')).toBe(id);
    expect(requests.filter(r => r.url.includes('uploadType=resumable'))).toHaveLength(1);
  });
  it('does not upload when the metadata reservation fails', async () => { db.fail = true; await expect(storePrivate('a.txt','text/plain',bytes)).rejects.toThrow('D1 unavailable'); expect(contents.size).toBe(0); });
  it('restarts an interrupted partial upload on the original reserved ID', async () => {
    const id = await storePrivate('a.txt','text/plain',bytes,'partial','u1'); const key = 'drive:v2:upload:partial'; const row = JSON.parse(db.rows.get(key) || '{}'); row.state = 'reserved'; db.rows.set(key, JSON.stringify(row)); contents.set(id,new Uint8Array([1]));
    expect(await storePrivate('a.txt','text/plain',bytes,'partial','u1')).toBe(id);
    expect(requests.some(r => r.method === 'PATCH' && r.url.includes(`/files/${id}?uploadType=resumable`))).toBe(true);
    expect(Array.from(contents.get(id) ?? [])).toEqual(Array.from(bytes));
  });
  it('completes multiple resumable chunks including an intermediate 308 response', async () => {
    const large = new Uint8Array(4 * 1024 * 1024 + 7); large[large.length-1] = 42;
    const id = await storePrivate('a.zip','application/zip',large,'large','u1');
    expect(contents.get(id)?.length).toBe(large.length); expect(contents.get(id)?.at(-1)).toBe(42);
    expect(requests.filter(r => r.method === 'PUT')).toHaveLength(2);
  });
  it('supports empty text outputs without reporting an incomplete session', async () => {
    const id = await storePrivate('empty.txt','text/plain',new Uint8Array(),'empty','u1'); expect(contents.get(id)?.length).toBe(0);
  });
  it('does not accept a retry with changed content or another owner', async () => {
    await storePrivate('a.txt','text/plain',bytes,'stable','u1');
    await expect(storePrivate('a.txt','text/plain',new Uint8Array([1]),'stable','u1')).rejects.toThrow('does not match');
    await expect(storePrivate('a.txt','text/plain',bytes,'stable','u2')).rejects.toThrow('does not match');
  });
  it('bounds large output before any upload', async () => { await expect(storePrivate('a.wav','audio/wav',new Uint8Array(DRIVE_MAX_BYTES + 1))).rejects.toThrow('32 MB'); expect(requests).toHaveLength(0); });
  it('returns only the private application URL for user uploads', async () => { const file = await storeFile('u1','a.txt','text/plain',bytes); expect(file.url).toBe(`/api/files?id=${file.id}`); expect(file.url).not.toContain('google'); });
});
