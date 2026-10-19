import { describe, expect, it, vi } from "vitest";
import { DIAGNOSTIC_LIMITS, parseDiagnostic } from "@/lib/runtime/diagnostics";
import { handleRuntime } from "../../auth-gateway/src/runtime";

describe("private runtime diagnostics", () => {
  it("allows bounded story evidence but rejects malformed entries", () => {
    expect(parseDiagnostic({ id: "scene_5_1", stage: "scene_check", evidence: { scene: "rejected", findings: [] } })).not.toBeNull();
    expect(parseDiagnostic({ id: "../other", stage: "scene_check", evidence: {} })).toBeNull();
    expect(parseDiagnostic({ id: "x", stage: "scene_check", evidence: [] })).toBeNull();
    expect(parseDiagnostic({ id: "x", stage: "scene_check", evidence: { scene: "x".repeat(256_001) } })).toBeNull();
  });
  it("limits evidence retention to seven days", () => {
    expect(DIAGNOSTIC_LIMITS.retentionMs).toBe(604_800_000);
  });
  it("limits job evidence count and size", () => {
    expect(DIAGNOSTIC_LIMITS.maxEntries).toBe(64);
    expect(DIAGNOSTIC_LIMITS.maxJobBytes).toBe(4_000_000);
  });
  it("rejects diagnostics without a valid runner session before writing", async () => {
    const run = vi.fn();
    const db = { prepare: vi.fn(() => ({ bind: () => ({ first: async () => null, run }) })) };
    const response = await handleRuntime(new Request("https://vision.example/runtime/diagnostics", { method: "POST", body: "{}" }), { DB: db }, "/runtime/diagnostics");
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("does not accept another operation's runner", async () => {
    const run = vi.fn();
    const db = { prepare: vi.fn(() => ({ bind: () => ({ first: async <T,>() => ({ status: "running", session_expires: new Date(Date.now() + 60000).toISOString(), operation: "checksum" }) as T, run }) })) };
    const response = await handleRuntime(new Request("https://vision.example/runtime/diagnostics", { method: "POST", headers: { Authorization: `Bearer ${"a".repeat(64)}` }, body: "{}" }), { DB: db }, "/runtime/diagnostics");
    expect(response.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
});