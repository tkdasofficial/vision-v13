import { describe, expect, it } from "vitest";
import { PROJECT_NAME_MAX, clampProjectName, projectHeaderName } from "@/lib/project-name";

describe("project name rules", () => {
  it("stores at most 50 characters", () => {
    expect(PROJECT_NAME_MAX).toBe(50);
    expect(clampProjectName("a".repeat(80))).toHaveLength(50);
    expect(clampProjectName("  " + "b".repeat(60) + "  ")).toBe("b".repeat(50));
    expect(clampProjectName("Website redesign")).toBe("Website redesign");
  });
  it("shows 18 characters in a header, then three dots", () => {
    expect(projectHeaderName("abcdefghijklmnopqrst")).toBe("abcdefghijklmnopqr...");
    expect(projectHeaderName("abcdefghijklmnopqr")).toBe("abcdefghijklmnopqr");
    expect(projectHeaderName("Website redesign")).toBe("Website redesign");
    expect(projectHeaderName("😀".repeat(19))).toBe("😀".repeat(18) + "...");
  });
});
