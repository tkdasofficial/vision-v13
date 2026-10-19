import { describe, expect, it } from "vitest";
import { isApprovable, parseReport, effectiveStatus, type ValidationReport } from "@/lib/validation/contracts";

const base: ValidationReport = {
  profile: "story.assembly",
  version: 1,
  status: "passed",
  contract_hash: "c1",
  artifact_hash: "a1",
  findings: [],
  unverified: [],
};
const want = { contractHash: "c1", artifactHash: "a1" };

describe("runtime validation report contract", () => {
  it("approves only a passed report bound to the same contract and artifact", () => {
    expect(isApprovable(base, want)).toBe(true);
    expect(isApprovable({ ...base, artifact_hash: "other" }, want)).toBe(false);
    expect(isApprovable({ ...base, version: 2 }, want)).toBe(false);
  });

  it("unverified checks block approval", () => {
    const r = { ...base, status: "unverified" as const, unverified: ["semantic.background_visual"] };
    expect(isApprovable(r, want)).toBe(false);
  });

  it("a report claiming passed while carrying errors is treated as failed", () => {
    const r: ValidationReport = {
      ...base,
      findings: [{ code: "compliance.dialogue_words", constraint: "dialogue.words", message: "x", path: "units[0].Dialogue", unit: 1, severity: "error", repair_scope: [] }],
    };
    expect(effectiveStatus(r)).toBe("failed");
    expect(isApprovable(r, want)).toBe(false);
  });

  it("rejects malformed reports", () => {
    expect(parseReport({ profile: "x" })).toBeNull();
    expect(parseReport(base)).not.toBeNull();
    expect(parseReport({ ...base, findings: [null] })).toBeNull();
    expect(parseReport({ ...base, findings: [{ severity: "success" }] })).toBeNull();
    expect(parseReport({ ...base, unverified: [true] })).toBeNull();
  });
});
