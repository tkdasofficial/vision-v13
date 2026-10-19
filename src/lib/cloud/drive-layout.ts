import { FORMATS, formatOfName, type Category } from '@/lib/formats/inventory';
import { RUNTIME_OPS } from '@/lib/runtime/operations';

export const DRIVE_CATEGORIES: Record<Category, string> = {
  document: 'Documents', spreadsheet: 'Spreadsheets', data: 'Data_and_Databases', presentation: 'Presentations',
  code: 'Code_and_Development', config: 'Configuration', image: 'Images', audio: 'Audio', video: 'Video',
  archive: 'Archives', subtitle: 'Subtitles_and_Transcripts', ebook: 'Ebooks_and_Publishing',
  diagram: 'Diagrams_and_Graphics', font: 'Fonts', geo: 'Maps_and_Geospatial', contact: 'Contacts',
  calendar: 'Calendars', log: 'Logs_and_Diffs',
};
const outputs = new Set([...FORMATS.filter(f => f.create).map(f => f.id),
  ...FORMATS.flatMap(f => [...f.inline, ...(f.runtime?.targets ?? [])]),
  ...Object.values(RUNTIME_OPS).flatMap(op => [...(op.targets ?? [])])]);
export const DRIVE_OUTPUTS = FORMATS.filter(f => outputs.has(f.id));
export function driveDestination(name: string) {
  const f = formatOfName(name);
  return f && outputs.has(f.id)
    ? { category: DRIVE_CATEGORIES[f.category], format: f.id, folder: f.id.toUpperCase() }
    : { category: 'Other_Supported', format: 'other', folder: 'Files' };
}
export function safeDriveName(name: string) {
  return (name.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'file';
}
export function driveFolderTree() {
  const tree: Record<string, string[]> = {};
  for (const f of DRIVE_OUTPUTS) (tree[DRIVE_CATEGORIES[f.category]] ??= []).push(f.id.toUpperCase());
  tree.Other_Supported = ['Files'];
  return tree;
}
