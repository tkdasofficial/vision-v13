// Linear barcode generation (not QR). Validates input strictly and never "fixes" bad data silently.
import { code128, code39, ean13, ean8, upca, upce, drawingSVG } from "bwip-js/generic";

export const BARCODE_FORMATS = ["code128", "code39", "ean13", "ean8", "upca", "upce"] as const;
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];
export const BARCODE_LABELS: Record<BarcodeFormat, string> = { code128: "Code 128", code39: "Code 39", ean13: "EAN-13", ean8: "EAN-8", upca: "UPC-A", upce: "UPC-E" };

export class BarcodeError extends Error {}

/** GS1 mod-10 check digit for the digits given (without the check digit). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** Expands a UPC-E number (8 digits incl. number system + check) to its UPC-A body (11 digits). */
export function upceToUpca(v: string): string {
  const ns = v[0], d = v.slice(1, 7), last = d[5];
  let m: string;
  if ("012".includes(last)) m = d.slice(0, 2) + last + "0000" + d.slice(2, 5);
  else if (last === "3") m = d.slice(0, 3) + "00000" + d.slice(3, 5);
  else if (last === "4") m = d.slice(0, 4) + "00000" + d[4];
  else m = d.slice(0, 5) + "0000" + last;
  return ns + m;
}

export function normalizeFormat(f: unknown): BarcodeFormat | null {
  const k = String(f ?? "").toLowerCase().replace(/[\s_-]/g, "");
  const map: Record<string, BarcodeFormat> = { code128: "code128", c128: "code128", code39: "code39", c39: "code39", ean13: "ean13", ean: "ean13", ean8: "ean8", upca: "upca", upc: "upca", upce: "upce" };
  return map[k] ?? null;
}

/** Returns the exact value to encode, or throws a BarcodeError explaining what is wrong. */
export function validateBarcode(format: BarcodeFormat, raw: string): string {
  const v = String(raw ?? "");
  if (!v.length) throw new BarcodeError("Give me a value to encode.");
  const digits = (n: number[], name: string) => {
    if (!/^\d+$/.test(v)) throw new BarcodeError(`${name} accepts digits only.`);
    if (!n.includes(v.length)) throw new BarcodeError(`${name} needs ${n.join(" or ")} digits (got ${v.length}).`);
  };
  const check = (body: string, given: string, name: string) => {
    const want = gs1CheckDigit(body);
    if (Number(given) !== want) throw new BarcodeError(`Invalid ${name} check digit: expected ${want}, got ${given}.`);
  };
  switch (format) {
    case "code128":
      if (v.length > 80) throw new BarcodeError("Code 128 values can be up to 80 characters.");
      if (!/^[\x00-\x7f]+$/.test(v)) throw new BarcodeError("Code 128 supports standard ASCII characters only.");
      return v;
    case "code39":
      if (v.length > 43) throw new BarcodeError("Code 39 values can be up to 43 characters.");
      if (!/^[0-9A-Z \-.$/+%]+$/.test(v)) throw new BarcodeError("Code 39 allows A–Z (uppercase), 0–9, space and - . $ / + % only.");
      return v;
    case "ean13": digits([12, 13], "EAN-13"); if (v.length === 13) check(v.slice(0, 12), v[12], "EAN-13"); return v;
    case "ean8": digits([7, 8], "EAN-8"); if (v.length === 8) check(v.slice(0, 7), v[7], "EAN-8"); return v;
    case "upca": digits([11, 12], "UPC-A"); if (v.length === 12) check(v.slice(0, 11), v[11], "UPC-A"); return v;
    case "upce":
      digits([7, 8], "UPC-E");
      if (v[0] !== "0" && v[0] !== "1") throw new BarcodeError("UPC-E must start with number system 0 or 1.");
      if (v.length === 8) check(upceToUpca(v.slice(0, 7)), v[7], "UPC-E");
      return v;
  }
}

const RENDER = { code128, code39, ean13, ean8, upca, upce };

export function barcodeSvg(format: BarcodeFormat, value: string): string {
  const text = validateBarcode(format, value);
  try {
    return RENDER[format]({ bcid: format, text, scale: 3, height: 15, includetext: true, textxalign: "center", paddingwidth: 10, paddingheight: 10, backgroundcolor: "FFFFFF" } as any, drawingSVG());
  } catch (e: any) {
    throw new BarcodeError(`Could not encode this value as ${BARCODE_LABELS[format]}: ${String(e?.message ?? e).replace(/^bwipp\.\w+#?\d*:\s*/, "")}`);
  }
}
