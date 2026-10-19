export type TableSort = { column: number; direction: "ascending" | "descending" } | null;

export function compareTableValues(a: string, b: string) {
  const number = (value: string) => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(value.trim()) ? Number(value.trim().replace(/%$/, "")) : null;
  const left = number(a), right = number(b);
  return left !== null && right !== null ? left - right : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Spreadsheet programs interpret leading formula characters even inside CSV quotes.
export function tableToCsv(rows: string[][]) {
  return rows.map((row) => row.map((value) => {
    const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
}