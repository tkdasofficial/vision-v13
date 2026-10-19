import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), store: vi.fn(), mark: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/cloud/d1.server', () => ({ d1: mocks.query }));
vi.mock('@/lib/cloud/drive.server', () => ({ storePrivate: mocks.store, markDriveIndexed: mocks.mark }));
vi.mock('@/lib/jobs/artifact-store.server', () => ({ getArtifactBytes: mocks.read, deleteArtifactBytes: mocks.remove }));
import { migrateLegacyArtifacts } from '@/lib/cloud/drive-migration.server';
let row: any;
beforeEach(async () => {
  vi.resetAllMocks(); const bytes = new Uint8Array([1,2,3]);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
  row = { id: 'a1', name: 'a.txt', mime: 'text/plain', size: 3, sha256, user_id: 'u1', drive_file_id: 'd1:old' };
  mocks.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT *') ? [row] : sql.startsWith('UPDATE') ? [{ id: row.id }] : []);
  mocks.read.mockResolvedValue(bytes); mocks.store.mockResolvedValue('drive-id'); mocks.mark.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined);
});
describe('bounded legacy migration', () => {
  it('verifies bytes, keeps artifact IDs and only cleans up after reference persistence', async () => {
    expect(await migrateLegacyArtifacts()).toEqual({ migrated: 1, batchSize: 1 });
    expect(mocks.query.mock.calls[0][0]).toContain("kind != 'source'"); expect(mocks.query.mock.calls[0][0]).toContain('LIMIT 3');
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE job_artifacts'), ['drive-id', 'a1', 'd1:old']);
    expect(mocks.remove).toHaveBeenCalledWith('d1:old');
  });
  it('retains D1 bytes and references when Drive rejects the upload', async () => {
    mocks.store.mockRejectedValue(new Error('denied')); await expect(migrateLegacyArtifacts()).rejects.toThrow('denied');
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.query.mock.calls.some(c => c[0].startsWith('UPDATE'))).toBe(false);
  });
  it('retains staging when metadata persistence fails', async () => {
    mocks.query.mockImplementation(async (sql: string) => { if (sql.startsWith('UPDATE')) throw new Error('database failed'); return [row]; });
    await expect(migrateLegacyArtifacts()).rejects.toThrow('database failed'); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('refuses corrupt legacy content before uploading', async () => {
    row.sha256 = 'wrong'; await expect(migrateLegacyArtifacts()).rejects.toThrow('integrity'); expect(mocks.store).not.toHaveBeenCalled();
  });
  it('does not remove staging still referenced by another artifact', async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT *') ? [row] : [{ id:'shared' }]);
    await migrateLegacyArtifacts(); expect(mocks.remove).not.toHaveBeenCalled();
  });
});
