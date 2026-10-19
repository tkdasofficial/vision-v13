// Thin TS adapter for the vision-runtime `validators/` report contract (version-locked).
// The app never re-runs the Python engine; it only checks a report is well-formed, bound to the
// artifact it approves, and actually passed. A score never overrides failed/unverified checks.

export const VALIDATOR_VERSION = 1;

export type ValidationStatus = "passed" | "failed" | "unverified";

export interface Finding {
  code: string;
  constraint: string;
  message: string;
  path: string;
  unit: number | null;
  expected?: unknown;
  observed?: unknown;
  severity: "error" | "warning";
  repair_scope: string[];
}

export interface ValidationReport {
  profile: string;
  version: number;
  status: ValidationStatus;
  contract_hash: string;
  artifact_hash: string;
  findings: Finding[];
  unverified: string[];
}

export function parseReport(raw: unknown): ValidationReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.profile !== "string" || typeof r.version !== "number") return null;
  if (r.status !== "passed" && r.status !== "failed" && r.status !== "unverified") return null;
  if (typeof r.contract_hash !== "string" || typeof r.artifact_hash !== "string") return null;
  if (!Array.isArray(r.findings) || !Array.isArray(r.unverified)) return null;
  if (!r.unverified.every((item) => typeof item === "string")) return null;
  if (!r.findings.every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const f = item as Record<string, unknown>;
    return ["code", "constraint", "message", "path"].every((key) => typeof f[key] === "string") &&
      (f.unit === null || (typeof f.unit === "number" && Number.isInteger(f.unit) && f.unit > 0)) &&
      (f.severity === "error" || f.severity === "warning") &&
      Array.isArray(f.repair_scope) && f.repair_scope.every((path) => typeof path === "string");
  })) return null;
  return r as unknown as ValidationReport;
}

/** Recomputes status from findings so a report cannot claim "passed" while carrying errors. */
export function effectiveStatus(report: ValidationReport): ValidationStatus {
  if (report.findings.some((f) => f.severity === "error")) return "failed";
  return report.unverified.length ? "unverified" : "passed";
}

export function isApprovable(
  report: ValidationReport | null,
  expected: { contractHash: string; artifactHash: string },
): boolean {
  return (
    !!report &&
    report.version === VALIDATOR_VERSION &&
    report.contract_hash === expected.contractHash &&
    report.artifact_hash === expected.artifactHash &&
    report.status === "passed" &&
    effectiveStatus(report) === "passed"
  );
}

/** Safe, content-free summary for user-facing failure reasons. */
export function failureSummary(report: ValidationReport): string {
  const codes = [...new Set(report.findings.filter((f) => f.severity === "error").map((f) => f.code))];
  if (codes.length) return `Checks failed: ${codes.slice(0, 4).join(", ")}`;
  if (report.unverified.length) return `Checks could not be verified: ${report.unverified.slice(0, 4).join(", ")}`;
  return "All checks passed";
}
