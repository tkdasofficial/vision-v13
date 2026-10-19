import { describe, it, expect } from "vitest";
import { isRefusedContext } from "@/lib/pwa";
const at = (hostname: string, search = "") => ({ hostname, search });
describe("service worker registration guard", () => {
  it("registers on the published site", () => expect(isRefusedContext(at("vision.example.com"), false, true)).toBe(false));
  it("refuses in dev", () => expect(isRefusedContext(at("vision.example.com"), false, false)).toBe(true));
  it("refuses inside an iframe", () => expect(isRefusedContext(at("vision.example.com"), true, true)).toBe(true));
  it("refuses on preview hosts", () => {
    expect(isRefusedContext(at("id-preview--abc.lovable.app"), false, true)).toBe(true);
    expect(isRefusedContext(at("x.lovableproject.com"), false, true)).toBe(true);
  });
  it("refuses with ?sw=off", () => expect(isRefusedContext(at("vision.example.com", "?sw=off"), false, true)).toBe(true));
});
