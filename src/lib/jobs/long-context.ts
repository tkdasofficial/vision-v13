// Pure logic for Long Context Generation jobs: catalog planning, record
// extraction and validation. No I/O; tested in src/test/long-context.test.ts.

export const CATALOG_COLUMNS = [
  "Product ID", "Product Name", "Category", "Subcategory", "Brand", "Product Description",
  "Unit Price", "Currency", "Stock Quantity", "SKU", "Supplier", "Rating",
  "Review Count", "Weight", "Dimensions", "Product Status",
] as const;

export const CATALOG_CATEGORIES: Record<string, string[]> = {
  "Electronics": ["Audio", "Wearables", "Computers", "Cameras"],
  "Home & Kitchen": ["Cookware", "Bedding", "Storage", "Lighting"],
  "Sports & Outdoors": ["Fitness", "Camping", "Cycling", "Team Sports"],
  "Beauty & Care": ["Skincare", "Haircare", "Fragrance", "Grooming"],
  "Toys & Games": ["Building Sets", "Dolls", "Puzzles", "Board Games"],
};

export const CATALOG_BATCH = 50;
export const MAX_ROWS = 2000;

/** True when the request asks for a spreadsheet/workbook file. */
export function wantsWorkbook(prompt: string): boolean {
  return /\b(excel|xlsx|spreadsheet|workbook)\b/i.test(prompt);
}

/** Row target stated in the request ("500 records"), clamped to a safe range. */
export function rowCountFor(prompt: string, fallback = 500): number {
  const m = prompt.match(/\b(\d{2,5})\s*(?:distinct\s+|unique\s+|fictional\s+)*(?:records?|rows?|products?|entries|items)\b/i);
  const n = m ? Number(m[1]) : fallback;
  return Math.min(MAX_ROWS, Math.max(10, Math.round(n)));
}

/**
 * Deterministic outline for a tabular catalog workload: one section per batch of
 * records. Each title carries the exact ID/SKU range and the assigned category so
 * chunks cannot collide and categories stay internally consistent.
 */
export function catalogOutline(totalRows: number, batch = CATALOG_BATCH): string[] {
  const cats = Object.keys(CATALOG_CATEGORIES);
  const titles: string[] = [];
  for (let start = 1; start <= totalRows; start += batch) {
    const end = Math.min(totalRows, start + batch - 1);
    const cat = cats[titles.length % cats.length];
    titles.push(`Records ${start}-${end}: category "${cat}" (subcategories: ${CATALOG_CATEGORIES[cat].join(", ")}). Product IDs P-${String(start).padStart(4, "0")} to P-${String(end).padStart(4, "0")}, SKUs SKU-${String(start).padStart(5, "0")} to SKU-${String(end).padStart(5, "0")}`);
  }
  return titles;
}

/** Model messages for one catalog batch: JSON records only, no prose. */
export function catalogChunkMessages(instructions: string, sectionTitle: string, count: number): unknown[] {
  return [
    { role: "system", content: `You generate fictional product catalog data for a spreadsheet. Reply with ONLY a JSON array of exactly ${count} objects — no markdown fences, no commentary. Each object has exactly these keys: ${CATALOG_COLUMNS.join(", ")}. Rules: "Unit Price" is a positive number, "Currency" is "USD", "Stock Quantity" and "Review Count" are non-negative integers, "Rating" is a number from 1 to 5 with one decimal, "Weight" looks like "1.2 kg", "Dimensions" looks like "30 x 20 x 10 cm", "Product Status" is one of "Active", "Out of Stock", "Discontinued". Every brand, supplier, product and identifier must be fictional and distinct within the batch.` },
    { role: "user", content: `Overall request:\n${instructions}\n\nYour batch — ${sectionTitle}\n\nGenerate exactly ${count} records for this batch, using only the ID range, SKU range, category and its subcategories named above.` },
  ];
}

/** Extracts the JSON record array from a chunk's text (fences and prose tolerated). */
export function parseRecords(text: string): Record<string, unknown>[] {
  const clean = text.replace(/```(?:json)?/gi, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array in chunk output");
  const parsed = JSON.parse(clean.slice(start, end + 1));
  if (!Array.isArray(parsed) || !parsed.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new Error("chunk output is not an array of objects");
  return parsed as Record<string, unknown>[];
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : NaN);

/** Normalizes one raw record into typed spreadsheet values in CATALOG_COLUMNS order. */
export function normalizeRecord(r: Record<string, unknown>): unknown[] {
  return CATALOG_COLUMNS.map((c) => {
    const v = r[c];
    if (c === "Unit Price") return Math.round(num(v) * 100) / 100;
    if (c === "Rating") return Math.round(num(v) * 10) / 10;
    if (c === "Stock Quantity" || c === "Review Count") return Math.trunc(num(v));
    return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  });
}

/** Validates the assembled catalog against the workload contract. */
export function validateCatalog(rows: unknown[][], expectedRows: number): { ok: true } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (rows.length !== expectedRows) problems.push(`Expected ${expectedRows} records, got ${rows.length}`);
  const ids = new Set<string>(), skus = new Set<string>();
  rows.forEach((row, i) => {
    if (row.length !== CATALOG_COLUMNS.length) problems.push(`Row ${i + 1}: expected ${CATALOG_COLUMNS.length} columns, got ${row.length}`);
    row.forEach((v, ci) => { if (v === "" || v == null) problems.push(`Row ${i + 1}: empty "${CATALOG_COLUMNS[ci]}"`); });
    const id = String(row[0]), sku = String(row[9]);
    if (ids.has(id)) problems.push(`Row ${i + 1}: duplicate Product ID ${id}`); else ids.add(id);
    if (skus.has(sku)) problems.push(`Row ${i + 1}: duplicate SKU ${sku}`); else skus.add(sku);
    if (!(Number(row[6]) > 0)) problems.push(`Row ${i + 1}: invalid Unit Price`);
    if (!Number.isInteger(row[8]) || (row[8] as number) < 0) problems.push(`Row ${i + 1}: invalid Stock Quantity`);
    if (!(Number(row[11]) >= 1 && Number(row[11]) <= 5)) problems.push(`Row ${i + 1}: Rating out of 1-5 range`);
    if (!Number.isInteger(row[12]) || (row[12] as number) < 0) problems.push(`Row ${i + 1}: invalid Review Count`);
  });
  const sample = problems.slice(0, 20);
  if (problems.length > 20) sample.push(`…and ${problems.length - 20} more`);
  return problems.length ? { ok: false, problems: sample } : { ok: true };
}
