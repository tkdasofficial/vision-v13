import { describe, expect, it } from "vitest";
import { appendTranscript } from "@/lib/append-transcript";

describe("voice typing", () => {
  it("appends speech without replacing existing typed text", () => {
    expect(appendTranscript("Already typed", "spoken words")).toBe("Already typed spoken words");
  });
  it("starts from an empty input", () => {
    expect(appendTranscript("", "spoken words")).toBe("spoken words");
  });
  it("preserves existing whitespace", () => {
    expect(appendTranscript("Already typed\n", "spoken words")).toBe("Already typed\nspoken words");
  });
});