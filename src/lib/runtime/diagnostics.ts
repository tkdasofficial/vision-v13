/** Private evidence limits never relax story acceptance. */
export const DIAGNOSTIC_LIMITS = { retentionMs: 604_800_000, maxEntryBytes: 256_000, maxJobBytes: 4_000_000, maxEntries: 64 } as const;
export type DiagnosticEntry = { id: string; stage: string; evidence: Record<string, unknown> };
export function parseDiagnostic(value: unknown): DiagnosticEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.id)) return null;
  if (typeof row.stage !== "string" || !/^[a-z_]{1,40}$/.test(row.stage)) return null;
  if (!row.evidence || typeof row.evidence !== "object" || Array.isArray(row.evidence)) return null;
  if (new TextEncoder().encode(JSON.stringify(row.evidence)).byteLength > DIAGNOSTIC_LIMITS.maxEntryBytes) return null;
  return { id: row.id, stage: row.stage, evidence: row.evidence as Record<string, unknown> };
}