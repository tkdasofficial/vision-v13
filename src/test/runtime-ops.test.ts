import { describe, it, expect } from "vitest";
import { detectRuntimeOp, cleanParams, outputMatches, outputName, targetFormat, isRuntimeOp, isConversionRequest } from "@/lib/runtime/operations";
import { verifyGithubOidc } from "../../auth-gateway/src/runtime";

const MB = 1024 * 1024;
const png = { name: "photo.png", mime: "image/png", size: 2 * MB };

describe("runtime operation routing", () => {
  it("routes image conversions with the right target", () => {
    expect(detectRuntimeOp("Convert this PNG to WebP", [png])).toEqual({ operation: "image_convert", params: { target: "webp" }, fileIndex: 0 });
    expect(detectRuntimeOp("convert to jpg please", [png])).toMatchObject({ params: { target: "jpeg" } });
  });
  it("routes video conversions", () => {
    expect(detectRuntimeOp("Convert this video to MP4", [{ name: "clip.webm", mime: "video/webm", size: 3 * MB }])).toMatchObject({ operation: "video_convert", params: { target: "mp4" } });
  });
  it("rejects unsupported or pointless conversions with a clear error", () => {
    expect(detectRuntimeOp("convert to psd", [png])).toHaveProperty("error");
    expect(detectRuntimeOp("convert to png", [png])).toEqual({ error: "This file is already PNG." });
    expect(detectRuntimeOp("convert to webp", [{ ...png, size: 30 * MB }])).toHaveProperty("error");
  });
  it("leaves unrelated requests alone", () => {
    expect(detectRuntimeOp("summarize this", [png])).toBeNull();
    expect(detectRuntimeOp("convert to webp", [])).toBeNull();
    expect(detectRuntimeOp("convert to webp", [png, png])).toBeNull();
    expect(detectRuntimeOp("sha-256 of this", [{ name: "a.bin", mime: "", size: 100 }])).toBeNull(); // small files hash inline
  });
  it("sends large-file checksums to the runner, keeping the expected hash", () => {
    const h = "a".repeat(64);
    expect(detectRuntimeOp(`verify sha256 ${h}`, [{ name: "big.iso", mime: "", size: 12 * MB }])).toMatchObject({ operation: "checksum", params: { algorithms: ["sha256"], expected: h } });
  });
  it("only allows registered operations and params", () => {
    expect(isRuntimeOp("image_convert")).toBe(true);
    expect(isRuntimeOp("bash")).toBe(false);
    expect(() => cleanParams("image_convert", { target: "exe" })).toThrow();
    expect(cleanParams("image_convert", { target: "png", cmd: "rm -rf /" })).toEqual({ target: "png" });
    expect(cleanParams("checksum", { algorithms: ["md5", "sha512"], expected: "zz" })).toEqual({ algorithms: ["sha512"] });
  });
  it("parses target formats", () => { expect(targetFormat("save it as a GIF", ["gif"])).toBe("gif"); expect(targetFormat("hello", ["gif"])).toBeNull(); });
  it("understands short and casual conversion requests", () => {
    expect(detectRuntimeOp("png", [{ ...png, name: "a.jpg", mime: "image/jpeg" }])).toMatchObject({ operation: "image_convert", params: { target: "png" } });
    expect(detectRuntimeOp("make it a gif", [png])).toMatchObject({ operation: "image_convert", params: { target: "gif" } });
    expect(detectRuntimeOp("extract audio as mp3", [{ name: "v.mp4", mime: "video/mp4", size: 3 * MB }])).toMatchObject({ operation: "audio_convert", params: { target: "mp3" } });
    expect(detectRuntimeOp("convert to flac", [{ name: "s.mp3", mime: "audio/mpeg", size: 3 * MB }])).toMatchObject({ operation: "audio_convert", params: { target: "flac" } });
  });
  it("keeps photos as files only when a format change is asked for", () => {
    expect(isConversionRequest("Convert this to WebP")).toBe(true);
    expect(isConversionRequest("jpg")).toBe(true);
    expect(isConversionRequest("make it a png")).toBe(true);
    expect(isConversionRequest("What is in this photo?")).toBe(false);
    expect(isConversionRequest("make it brighter")).toBe(false);
  });
});

describe("runtime output validation", () => {
  it("checks magic bytes of outputs", () => {
    expect(outputMatches("png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe(true);
    expect(outputMatches("png", new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe(false);
    expect(outputMatches("webp", new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(outputMatches("mp4", new TextEncoder().encode("\0\0\0\x18ftypisom"))).toBe(true);
  });
  it("builds safe output names", () => { expect(outputName("../../evil<>.png", "jpeg")).toBe("evil_.jpg"); });
});

describe("relay runner authentication", () => {
  it("rejects tokens that are not valid GitHub OIDC JWTs", async () => {
    expect(await verifyGithubOidc("")).toBeNull();
    expect(await verifyGithubOidc("a.b")).toBeNull();
    const fake = [{ alg: "none" }, { repository: "tkdasofficial/vision-runtime" }].map((o) => btoa(JSON.stringify(o))).join(".") + ".sig";
    expect(await verifyGithubOidc(fake)).toBeNull();
  });
});
