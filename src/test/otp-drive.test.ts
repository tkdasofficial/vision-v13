import { describe, expect, it } from "vitest";
import { generateOtp } from "@/lib/cloud/otp.server";
import { kindForMime } from "@/lib/cloud/drive.server";

describe("email verification codes", () => {
  it("generates 8-digit codes", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOtp()).toMatch(/^\d{8}$/);
    }
  });
});

describe("Drive sub-folder mapping", () => {
  it("sorts files into the right sub-folders", () => {
    expect(kindForMime("image/png", "a.png")).toBe("Images");
    expect(kindForMime("video/mp4", "a.mp4")).toBe("Videos");
    expect(kindForMime("application/pdf", "a.pdf")).toBe("PDFs");
    expect(kindForMime("text/plain", "a.txt")).toBe("Text");
    expect(kindForMime("application/octet-stream", "a.ts")).toBe("Code");
    expect(kindForMime("application/zip", "a.zip")).toBe("Other");
  });
});
