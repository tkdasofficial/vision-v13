import { d1 } from './d1.server';
import { storePrivate, markDriveIndexed } from './drive.server';
import { getArtifactBytes, deleteArtifactBytes } from '../jobs/artifact-store.server';

/** Bounded, repeatable migration of existing unexpired final artifacts; source staging is untouched. */
export async function migrateLegacyArtifacts() {
  const rows = await d1<any>("SELECT * FROM job_artifacts WHERE drive_file_id LIKE 'd1:%' AND kind != 'source' AND expires_at > ? ORDER BY size ASC LIMIT 3", [new Date().toISOString()]);
  let migrated = 0;
  for (const row of rows) {
    const bytes = await getArtifactBytes(row.drive_file_id);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== row.size || hash !== row.sha256) throw new Error('Legacy file failed integrity verification. No reference was changed.');
    const identity = `migration:${row.id}`;
    const id = await storePrivate(row.name, row.mime, bytes, identity, row.user_id);
    const won = await d1('UPDATE job_artifacts SET drive_file_id = ? WHERE id = ? AND drive_file_id = ? RETURNING id', [id, row.id, row.drive_file_id]);
    if (won.length) {
      await markDriveIndexed(identity);
      const refs = await d1<any>('SELECT id FROM job_artifacts WHERE drive_file_id = ?', [row.drive_file_id]);
      if (!refs.length) await deleteArtifactBytes(row.drive_file_id);
      migrated++;
    }
  }
  return { migrated, batchSize: rows.length };
}