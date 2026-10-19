// Artifact Execution & Delivery (Task 3): owner-only access, expiry, integrity verification,
// and honest, distinct errors for every failure mode.
import { describe, expect, it } from "vitest";
import { artifactResponse, contentDisposition } from "@/lib/jobs/artifact-download";

const sha = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, "0")).join("");

const ID = "123e4567-e89b-42d3-a456-426614174000";
const makeRecord = async (over: Partial<any> = {}) => {
  const bytes = new TextEncoder().encode("exact file content");
  return {
    record: { id: ID, user_id: "u1", name: "story.pdf", mime: "application/pdf", size: bytes.length, sha256: await sha(bytes), drive_file_id: "d1:x", kind: "file", expires_at: new Date(Date.now() + 86400_000).toISOString(), ...over },
    bytes,
  };
};

const call = (o: { userId?: string | null; record?: any; bytes?: Uint8Array; readError?: Error; now?: number }) =>
  artifactResponse({
    userId: o.userId === undefined ? "u1" : o.userId,
    id: ID,
    find: async () => o.record ?? null,
    read: async () => { if (o.readError) throw o.readError; return o.bytes ?? new Uint8Array(); },
    now: o.now,
  });

describe("delivery succeeds only for the owner with an intact file", () => {
  it("delivers exact bytes, name, mime and checksum to the owner", async () => {
    const { record, bytes } = await makeRecord();
    const res = await call({ record, bytes });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("story.pdf");
    expect(res.headers.get("X-Checksum-SHA256")).toBe(record.sha256);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
  });
  it("rejects signed-out callers (401)", async () => {
    const { record, bytes } = await makeRecord();
    expect((await call({ userId: null, record, bytes })).status).toBe(401);
  });
  it("rejects another user's file (403), never leaks it", async () => {
    const { record, bytes } = await makeRecord();
    expect((await call({ userId: "u2", record, bytes })).status).toBe(403);
  });
  it("rejects expired files (410)", async () => {
    const { record, bytes } = await makeRecord({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await call({ record, bytes })).status).toBe(410);
  });
});

describe("verification before delivery", () => {
  it("refuses a corrupted file with a distinct error (500 corrupted)", async () => {
    const { record } = await makeRecord();
    const res = await call({ record, bytes: new TextEncoder().encode("tampered content!") });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("corrupted");
  });
  it("refuses a truncated file", async () => {
    const { record, bytes } = await makeRecord();
    expect((await call({ record, bytes: bytes.subarray(0, 3) })).status).toBe(500);
  });
  it("reports a missing stored object (404) and storage failure (502) distinctly", async () => {
    const { record } = await makeRecord();
    expect((await call({ record, readError: new Error("object not found 404") })).status).toBe(404);
    expect((await call({ record, readError: new Error("connection refused") })).status).toBe(502);
  });
});

describe("filenames survive delivery", () => {
  it("keeps a UTF-8 name and a safe ASCII fallback", () => {
    const cd = contentDisposition("résumé 2026.pdf");
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain("filename=\"r_sum_ 2026.pdf\"");
  });
});
