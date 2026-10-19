// Archive safety rules: path checks, size/count/ratio limits and export exclusions.
// Pure and store-agnostic so it can be tested without a worker or storage.

export const ARCHIVE_LIMITS = {
  maxUploadBytes: 25 * 1024 * 1024, // compressed ZIP size accepted from a user
  maxEntries: 5000,
  maxTotalUncompressed: 200 * 1024 * 1024,
  maxEntryUncompressed: 20 * 1024 * 1024,
  maxRatio: 100, // uncompressed / compressed, per entry (only checked above 1 MB)
  maxDepth: 30,
  maxTextExtractBytes: 1024 * 1024, // per text file read for analysis
  maxTextFiles: 2000,
} as const;

export type EntryMeta = { name: string; compressedSize: number; originalSize: number };
export type ArchiveIssue = { code: string; path?: string; message: string };

/** Normalizes a ZIP entry path; returns null when it is unsafe (absolute, traversal, drive letter, control chars). */
export function safeEntryPath(raw: string): string | null {
  if (!raw || raw.length > 1024) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  if (!parts.length) return null;
  return parts.join("/") + (p.endsWith("/") ? "/" : "");
}

/** Checks the archive directory listing before anything is decompressed. */
export function inspectEntries(entries: EntryMeta[], limits = ARCHIVE_LIMITS): { ok: boolean; issues: ArchiveIssue[] } {
  const issues: ArchiveIssue[] = [];
  if (entries.length > limits.maxEntries) issues.push({ code: "too_many_entries", message: `Archive has ${entries.length} entries (limit ${limits.maxEntries}).` });
  let total = 0;
  for (const e of entries) {
    const safe = safeEntryPath(e.name);
    if (!safe) { issues.push({ code: "unsafe_path", path: e.name, message: "Unsafe file path (absolute or outside the archive)." }); continue; }
    if (safe.split("/").filter(Boolean).length > limits.maxDepth) issues.push({ code: "too_deep", path: safe, message: "Folder nesting is too deep." });
    if (e.originalSize > limits.maxEntryUncompressed) issues.push({ code: "entry_too_large", path: safe, message: "A file inside the archive is too large." });
    if (e.originalSize > 1024 * 1024 && e.compressedSize > 0 && e.originalSize / e.compressedSize > limits.maxRatio) {
      issues.push({ code: "suspicious_ratio", path: safe, message: "Compression ratio looks like an archive bomb." });
    }
    total += Math.max(0, e.originalSize);
  }
  if (total > limits.maxTotalUncompressed) issues.push({ code: "too_large_total", message: "Archive expands to more than the allowed total size." });
  return { ok: issues.length === 0, issues };
}

const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "dist", "build", ".next", ".cache", ".turbo", "__pycache__", ".venv", "venv", ".idea", ".DS_Store", "coverage"]);
const SECRET_FILE = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|id_dsa|.*\.pem|.*\.key|.*\.p12|.*\.pfx|\.npmrc|\.pypirc|credentials(\.json)?)$/i;
const SAFE_ENV = /(^|\/)\.env\.(example|sample|template)$/i;

/** True when a file must not go into an exported archive by default. */
export function isExcludedFromExport(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (SAFE_ENV.test(path)) return false;
  return SECRET_FILE.test(path) || /\.(log|tmp|swp)$/i.test(path);
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Private key block", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /AIza[0-9A-Za-z_\-]{35}/],
  ["Stripe secret key", /sk_live_[0-9a-zA-Z]{20,}/],
  ["Generic secret assignment", /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i],
];

/** Names of secret types found in text (never returns the secret itself). */
export function findSecretKinds(text: string): string[] {
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);
}
