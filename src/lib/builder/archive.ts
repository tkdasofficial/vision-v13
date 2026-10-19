// ZIP packaging and safe reading. Pure (fflate), used by server job runners and tests.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { ARCHIVE_LIMITS, inspectEntries, isExcludedFromExport, safeEntryPath, type ArchiveIssue, type EntryMeta } from "../../../security/archive/zip-guard";
import type { GenFile } from "./stacks";

export type PackResult = { bytes: Uint8Array; included: string[]; excluded: string[] };

/** Packs files under one root folder, skipping secrets, caches and dependency folders. */
export function packProject(root: string, files: GenFile[]): PackResult {
  const tree: Record<string, Uint8Array> = {};
  const included: string[] = [], excluded: string[] = [];
  for (const f of files) {
    const p = safeEntryPath(f.path);
    if (!p || p.endsWith("/") || isExcludedFromExport(p)) { excluded.push(f.path); continue; }
    tree[`${root}/${p}`] = strToU8(f.content);
    included.push(p);
  }
  return { bytes: zipSync(tree, { level: 6 }), included, excluded };
}

/** Reopens a packed archive and confirms every expected file is present with identical content. */
export function verifyPack(bytes: Uint8Array, root: string, files: GenFile[], included: string[]): string[] {
  const problems: string[] = [];
  let out: Record<string, Uint8Array>;
  try { out = unzipSync(bytes); } catch { return ["Archive could not be reopened."]; }
  const want = new Map(files.map((f) => [f.path, f.content]));
  for (const p of included) {
    const got = out[`${root}/${p}`];
    if (!got) problems.push(`${p} is missing from the archive.`);
    else if (strFromU8(got) !== want.get(p)) problems.push(`${p} content differs inside the archive.`);
  }
  if (Object.keys(out).length !== included.length) problems.push("Archive contains unexpected files.");
  return problems;
}

const TEXT_EXT = /\.(txt|md|mdx|json|jsonc|xml|csv|ya?ml|toml|ini|cfg|conf|env\.example|js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|html?|css|scss|sass|less|svg|sh|bash|zsh|ps1|bat|sql|graphql|gql|prisma|dockerfile|gitignore|editorconfig|lock)$/i;
const TEXT_NAMES = /(^|\/)(Dockerfile|Makefile|Procfile|LICENSE|README|CHANGELOG|\.gitignore|\.env|\.env\..+)$/i;
export const isTextPath = (p: string) => TEXT_EXT.test(p) || TEXT_NAMES.test(p);

export type ReadEntry = { path: string; size: number; compressedSize: number; dir: boolean; text?: string; nestedArchive?: boolean };
export type ReadResult = { ok: true; entries: ReadEntry[]; skippedText: number } | { ok: false; issues: ArchiveIssue[] };

/**
 * Lists an archive and extracts only small text files, after directory-level safety checks.
 * Nothing is executed; binary files and nested archives are listed but not opened.
 */
export function readArchiveSafely(bytes: Uint8Array, limits = ARCHIVE_LIMITS): ReadResult {
  if (bytes.length > limits.maxUploadBytes) return { ok: false, issues: [{ code: "upload_too_large", message: "ZIP is larger than 25 MB." }] };
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, issues: [{ code: "not_zip", message: "This file is not a valid ZIP archive." }] };

  const metas: EntryMeta[] = [];
  try {
    // First pass: directory only (filter returns false → nothing is decompressed).
    unzipSync(bytes, { filter: (f) => { metas.push({ name: f.name, compressedSize: f.size, originalSize: f.originalSize }); return false; } });
  } catch { return { ok: false, issues: [{ code: "corrupt", message: "The ZIP archive is damaged or uses an unsupported format." }] }; }
  const check = inspectEntries(metas, limits);
  if (!check.ok) return { ok: false, issues: check.issues };

  let textCount = 0, skippedText = 0;
  const wanted = new Set<string>();
  for (const m of metas) {
    const p = safeEntryPath(m.name)!;
    if (p.endsWith("/") || !isTextPath(p) || p.split("/").some((s) => s === "node_modules" || s === ".git")) continue;
    if (m.originalSize > limits.maxTextExtractBytes || textCount >= limits.maxTextFiles) { skippedText++; continue; }
    wanted.add(m.name); textCount++;
  }
  let data: Record<string, Uint8Array>;
  try { data = unzipSync(bytes, { filter: (f) => wanted.has(f.name) }); }
  catch { return { ok: false, issues: [{ code: "corrupt", message: "A file inside the ZIP could not be decompressed." }] }; }

  const entries: ReadEntry[] = metas.map((m) => {
    const p = safeEntryPath(m.name)!;
    const dir = p.endsWith("/");
    const raw = data[m.name];
    let text: string | undefined;
    if (raw && raw.length <= limits.maxTextExtractBytes) {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { text = undefined; }
    }
    return { path: p.replace(/\/$/, ""), size: m.originalSize, compressedSize: m.compressedSize, dir, text, nestedArchive: /\.(zip|tar|gz|tgz|rar|7z|jar|war)$/i.test(p) };
  });
  return { ok: true, entries, skippedText };
}
