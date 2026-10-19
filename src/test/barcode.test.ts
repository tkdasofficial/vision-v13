import { describe, it, expect } from "vitest";
import { barcodeSvg, validateBarcode, gs1CheckDigit, upceToUpca, normalizeFormat, BarcodeError } from "@/lib/tools/barcode";

describe("barcode validation", () => {
  it("computes GS1 check digits from known vectors", () => {
    expect(gs1CheckDigit("400638133393")).toBe(1); // 4006381333931
    expect(gs1CheckDigit("9638507")).toBe(4); // EAN-8 96385074
    expect(gs1CheckDigit("03600029145")).toBe(2); // UPC-A 036000291452
  });
  it("expands UPC-E", () => { expect(upceToUpca("0425261")).toBe("04210000526"); });
  it("accepts valid values", () => {
    expect(validateBarcode("code128", "Vision-42 ok")).toBe("Vision-42 ok");
    expect(validateBarcode("code39", "ABC-123")).toBe("ABC-123");
    expect(validateBarcode("ean13", "4006381333931")).toBe("4006381333931");
    expect(validateBarcode("ean8", "96385074")).toBe("96385074");
    expect(validateBarcode("upca", "036000291452")).toBe("036000291452");
    expect(validateBarcode("upce", "04252614")).toBe("04252614");
  });
  it("rejects invalid characters", () => {
    expect(() => validateBarcode("code39", "abc")).toThrow(BarcodeError);
    expect(() => validateBarcode("ean13", "40063813339A")).toThrow(/digits only/);
    expect(() => validateBarcode("code128", "café")).toThrow(/ASCII/);
  });
  it("rejects invalid lengths", () => {
    expect(() => validateBarcode("ean13", "123")).toThrow(/12 or 13 digits/);
    expect(() => validateBarcode("ean8", "123456789")).toThrow(/7 or 8/);
    expect(() => validateBarcode("upca", "1234")).toThrow(/11 or 12/);
  });
  it("rejects wrong check digits instead of fixing them", () => {
    expect(() => validateBarcode("ean13", "4006381333932")).toThrow(/expected 1, got 2/);
    expect(() => validateBarcode("upca", "036000291453")).toThrow(/check digit/);
    expect(() => validateBarcode("ean8", "96385075")).toThrow(/check digit/);
  });
  it("normalizes format names", () => {
    expect(normalizeFormat("Code 128")).toBe("code128");
    expect(normalizeFormat("EAN-13")).toBe("ean13");
    expect(normalizeFormat("qr")).toBeNull();
  });
});

describe("barcode rendering", () => {
  for (const [f, v] of [["code128", "HELLO123"], ["code39", "ABC123"], ["ean13", "4006381333931"], ["ean8", "96385074"], ["upca", "036000291452"], ["upce", "04252614"]] as const) {
    it(`renders ${f} as SVG`, () => {
      const svg = barcodeSvg(f, v);
      expect(svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
      expect(svg.length).toBeGreaterThan(500);
    });
  }
});
