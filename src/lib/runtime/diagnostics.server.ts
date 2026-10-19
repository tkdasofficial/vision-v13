import { d1 } from "@/lib/cloud/d1.server";
import { DIAGNOSTIC_LIMITS } from "./diagnostics";
/** Expired evidence is never returned, even before physical cleanup. */
export async function readRuntimeDiagnostics(userId: string, jobId: string) {
  const rows = await d1<{ id: string; stage: string; evidence: string; sha256: string; created_at: number; expires_at: number }>(
    "SELECT id,stage,evidence,sha256,created_at,expires_at FROM runtime_diagnostics WHERE user_id=? AND job_id=? AND expires_at>? ORDER BY created_at,id LIMIT ?",
    [userId, jobId, Date.now(), DIAGNOSTIC_LIMITS.maxEntries],
  );
  return rows.map((row) => ({ ...row, evidence: JSON.parse(row.evidence) }));
}