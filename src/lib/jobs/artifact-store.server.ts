// Final artifacts use private Drive only. D1 is bounded staging and legacy reads.
// Keys are opaque; "d1:" prefixed keys live in artifact_chunks.
import { d1 } from "@/lib/cloud/d1.server";

const CHUNK = 700_000; // bytes per row before base64 (keeps rows well under D1 limits)

function b64(bytes: Uint8Array) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s: string) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

export async function putArtifact(name: string, mime: string, bytes: Uint8Array, identity?: string, owner?: string): Promise<string> {
  const { storePrivate } = await import("@/lib/cloud/drive.server");
  return storePrivate(name, mime, bytes, identity, owner);
}

/** Always stores in D1 (the runtime relay reads/writes these chunks directly). */
export async function putD1Artifact(bytes: Uint8Array): Promise<{ key: string; chunks: number }> {
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Runtime inputs up to 25 MB are supported.");
  const key = `d1:${crypto.randomUUID()}`;
  let idx = 0;
  for (let i = 0; i < Math.max(bytes.length, 1); i += CHUNK, idx++) {
    await d1("INSERT INTO artifact_chunks (artifact_key, idx, data) VALUES (?, ?, ?)", [key, idx, b64(bytes.subarray(i, i + CHUNK))]);
  }
  return { key, chunks: idx };
}

export async function getArtifactBytes(key: string): Promise<Uint8Array> {
  if (!key.startsWith("d1:")) {
    const { readPrivate } = await import("@/lib/cloud/drive.server");
    return new Uint8Array(await (await readPrivate(key)).arrayBuffer());
  }
  const rows = await d1<{ data: string }>("SELECT data FROM artifact_chunks WHERE artifact_key = ? ORDER BY idx", [key]);
  if (!rows.length) throw new Error("Stored file not found");
  if (rows.reduce((n, r) => n + r.data.length, 0) > 45 * 1024 * 1024) throw new Error("This file exceeds the safe storage memory limit.");
  const parts = rows.map((r) => unb64(r.data));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function deleteArtifactBytes(key: string) {
  if (key.startsWith("d1:")) { await d1("DELETE FROM artifact_chunks WHERE artifact_key = ?", [key]); return; }
  const { deletePrivate } = await import("@/lib/cloud/drive.server");
  await deletePrivate(key);
}
