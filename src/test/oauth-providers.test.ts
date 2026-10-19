import { describe, expect, it } from "vitest";
import { providerCallbackUrl } from "@/lib/cloud/oauth-urls";

describe("providerCallbackUrl", () => {
  it("builds the callback for each provider from one origin", () => {
    const origin = "https://vision-auth.workers.dev";
    expect(providerCallbackUrl(origin, "google")).toBe(`${origin}/auth/google/callback`);
    expect(providerCallbackUrl(origin, "github")).toBe(`${origin}/auth/github/callback`);
  });

  it("trims a trailing slash so provider dashboards stay 200 OK", () => {
    expect(providerCallbackUrl("https://vision.example.com/", "github")).toBe(
      "https://vision.example.com/auth/github/callback"
    );
  });

  it("keeps the exact origin when it has no trailing slash", () => {
    expect(providerCallbackUrl("https://id-preview--e26fe501-ea6b-4f0e-b783-e17668983052.lovable.app", "google")).toBe(
      "https://id-preview--e26fe501-ea6b-4f0e-b783-e17668983052.lovable.app/auth/google/callback"
    );
  });
});
