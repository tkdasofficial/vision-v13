// Fictional sales workbook: formulas with verified cached values, linked summaries and native charts.
import { writeXlsx, type Sheet, type FormulaCell } from "@/lib/tools/office";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

export const SALES_COLUMNS = ["Order ID", "Date", "Region", "Product", "Category", "Quantity", "Unit Price", "Discount %", "Revenue", "Cost", "Profit", "Cost Rate"];
const regions = ["North", "South", "East", "West", "Central", "International"];
const categories = ["Electronics", "Apparel", "Home", "Sports", "Toys"];
const products = Array.from({ length: 25 }, (_, i) => ({ name: `Vision Sample ${String(i + 1).padStart(2, "0")}`, category: categories[i % 5] }));
const f = (formula: string, value: number, style = 5): FormulaCell => ({ formula, value, style });
const val = (cell: unknown): number => typeof cell === "number" ? cell : cell && typeof cell === "object" && "value" in cell ? Number(cell.value) : 0;
const sum = (rows: unknown[][], col: number) => rows.reduce((s, r) => s + val(r[col]), 0);
const ratio = (a: number, b: number) => b ? a / b : 0;
export const isBusinessWorkbook = (prompt: string) => /\bSales_Data\b/i.test(prompt) && /\bRegional_Analysis\b/i.test(prompt) && /\bMonthly_Trends\b/i.test(prompt);

export function buildBusinessSheets(count = 500, year = 2025): Sheet[] {
  if (!Number.isInteger(count) || count < 1 || count > 2000) throw new Error("Sales workbook supports 1–2000 transactions.");
  let seed = 42;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const data: unknown[][] = [];
  const start = Date.UTC(year, 0, 1);
  const days = (Date.UTC(year + 1, 0, 1) - start) / 86400000;
  for (let i = 0; i < count; i++) {
    const product = products[i % products.length];
    const quantity = 1 + Math.floor(random() * 50), price = Math.round((20 + random() * 980) * 100) / 100;
    const discount = Math.round(random() * 0.3 * 10000) / 10000, costRate = Math.round((0.6 + random() * 0.3) * 10000) / 10000;
    const row = i + 2, revenue = quantity * price * (1 - discount), cost = revenue * costRate;
    // Spread guaranteed coverage across all twelve months; numeric Excel serial dates.
    const date = (start - Date.UTC(1899, 11, 30)) / 86400000 + Math.floor(i * days / count);
    data.push([`ORD${1000 + i}`, date, regions[i % regions.length], product.name, product.category, quantity, price, discount,
      f(`F${row}*G${row}*(1-H${row})`, revenue), f(`I${row}*L${row}`, cost), f(`I${row}-J${row}`, revenue - cost), costRate]);
  }
  const end = count + 1;
  const range = (c: string) => `Sales_Data!$${c}$2:$${c}$${end}`;
  const regional = regions.map((region, i) => {
    const r = i + 2, subset = data.filter((d) => d[2] === region), revenue = sum(subset, 8), profit = sum(subset, 10);
    return [region, f(`SUMIF(${range("C")},A${r},${range("I")})`, revenue), f(`SUMIF(${range("C")},A${r},${range("J")})`, sum(subset, 9)),
      f(`SUMIF(${range("C")},A${r},${range("K")})`, profit), f(`IFERROR(D${r}/B${r},0)`, ratio(profit, revenue), 6),
      f(`COUNTIF(${range("C")},A${r})`, subset.length, 4), f(`IFERROR(B${r}/F${r},0)`, ratio(revenue, subset.length))];
  });
  const productRows = products.map((product, i) => {
    const r = i + 2, subset = data.filter((d) => d[3] === product.name), revenue = sum(subset, 8), profit = sum(subset, 10);
    return [product.name, f(`SUMIF(${range("D")},A${r},${range("I")})`, revenue), f(`SUMIF(${range("D")},A${r},${range("F")})`, sum(subset, 5), 4),
      f(`SUMIF(${range("D")},A${r},${range("K")})`, profit), f(`IFERROR(D${r}/B${r},0)`, ratio(profit, revenue), 6), f(`RANK(B${r},$B$2:$B$26,0)`, 0, 4)];
  });
  for (const r of productRows) (r[5] as FormulaCell).value = 1 + productRows.filter((p) => val(p[1]) > val(r[1])).length;
  let previous = 0;
  const monthly = Array.from({ length: 12 }, (_, month) => {
    const r = month + 2, serial = (Date.UTC(year, month, 1) - Date.UTC(1899, 11, 30)) / 86400000;
    const next = (Date.UTC(year, month + 1, 1) - Date.UTC(1899, 11, 30)) / 86400000;
    const subset = data.filter((d) => val(d[1]) >= serial && val(d[1]) < next), revenue = sum(subset, 8);
    const agg = (c: string, ci: number) => f(`SUMIFS(${range(c)},${range("B")},">="&A${r},${range("B")},"<"&DATE(YEAR(A${r}),MONTH(A${r})+1,1))`, sum(subset, ci));
    const row = [serial, agg("I", 8), agg("J", 9), agg("K", 10), f(month ? `IFERROR((B${r}-B${r - 1})/B${r - 1},0)` : "0", month ? ratio(revenue - previous, previous) : 0, 6),
      f(`COUNTIFS(${range("B")},">="&A${r},${range("B")},"<"&DATE(YEAR(A${r}),MONTH(A${r})+1,1))`, subset.length, 4)];
    previous = revenue; return row;
  });
  const totalRevenue = sum(data, 8), totalProfit = sum(data, 10);
  const top = [...productRows].sort((a, b) => val(b[1]) - val(a[1])).slice(0, 10);
  const dashboard: unknown[][] = [["Business performance", "Value", "Top 10 products", "Revenue ($)"],
    ["Total Revenue ($)", f(`SUM(${range("I")})`, totalRevenue)], ["Total Profit ($)", f(`SUM(${range("K")})`, totalProfit)],
    ["Profit Margin", f("IFERROR(B3/B2,0)", ratio(totalProfit, totalRevenue), 6)], ["Order Count", f(`COUNTA(${range("A")})`, count, 4)]];
  top.forEach((p, i) => {
    const r = i + 2;
    dashboard[i + 1] ??= [];
    dashboard[i + 1][2] = { formula: `INDEX(Product_Analysis!$A$2:$A$26,MATCH(${i + 1},Product_Analysis!$F$2:$F$26,0))`, value: String(p[0]) };
    dashboard[i + 1][3] = f(`LARGE(Product_Analysis!$B$2:$B$26,${i + 1})`, val(p[1]));
    // Dynamic product labels follow the same ranked source range.
    const sourceRow = productRows.indexOf(p) + 2;
    void r; void sourceRow;
  });
  return [
    { name: "Sales_Data", rows: [SALES_COLUMNS, ...data], widths: [16, 14, 18, 24, 18, 12, 18, 16, 20, 20, 20, 14], colStyles: { 1: 7, 5: 4, 6: 5, 7: 6, 8: 5, 9: 5, 10: 5, 11: 6 } },
    { name: "Regional_Analysis", rows: [["Region", "Revenue ($)", "Cost ($)", "Profit ($)", "Profit Margin", "Order Count", "Average Order Value ($)"], ...regional], widths: [20, 22, 22, 22, 18, 16, 26] },
    { name: "Product_Analysis", rows: [["Product", "Revenue ($)", "Quantity Sold", "Profit ($)", "Profit Margin", "Revenue Rank"], ...productRows], widths: [26, 22, 20, 22, 18, 18] },
    { name: "Monthly_Trends", rows: [["Month", "Revenue ($)", "Cost ($)", "Profit ($)", "MoM Revenue Growth", "Order Count"], ...monthly], widths: [16, 22, 22, 22, 24, 16], colStyles: { 0: 7 } },
    { name: "Dashboard", rows: dashboard, widths: [28, 24, 28, 24] },
  ];
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** Native OOXML charts with cached series and source-cell references; no bitmap previews. */
function addCharts(bytes: Uint8Array, sheets: Sheet[]): Uint8Array {
  const files = unzipSync(bytes);
  const specs = [
    { title: "Revenue by Region", sheet: sheets[1], cat: "A2:A7", values: "B2:B7", type: "bar", row: 14 },
    { title: "Top 10 Products by Revenue", sheet: sheets[4], cat: "C2:C11", values: "D2:D11", type: "col", row: 31 },
    { title: "Monthly Revenue Trend", sheet: sheets[3], cat: "A2:A13", values: "B2:B13", type: "line", row: 48 },
  ];
  const drawings: string[] = [];
  specs.forEach((spec, i) => {
    const source = spec.sheet.rows.slice(1), labels = source.map((r) => spec.sheet.name === "Dashboard" ? String((r[2] as FormulaCell)?.value ?? r[2]) : spec.sheet.name === "Monthly_Trends" ? new Date((val(r[0]) - 25569) * 86400000).toISOString().slice(0, 7) : String(r[0]));
    const values = source.map((r) => val(r[spec.sheet.name === "Dashboard" ? 3 : 1]));
    const ax1 = 100 + i * 2, ax2 = ax1 + 1;
    const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Revenue</c:v></c:tx><c:cat><c:strRef><c:f>'${spec.sheet.name}'!${spec.cat}</c:f><c:strCache><c:ptCount val="${labels.length}"/>${labels.map((s, j) => `<c:pt idx="${j}"><c:v>${escape(s)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>'${spec.sheet.name}'!${spec.values}</c:f><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, j) => `<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val></c:ser>`;
    const chart = spec.type === "line" ? `<c:lineChart><c:grouping val="standard"/>${series}<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:lineChart>` : `<c:barChart><c:barDir val="${spec.type}"/><c:grouping val="clustered"/>${series}<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:barChart>`;
    files[`xl/charts/chart${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${spec.title}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/>${chart}<c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="${ax2}"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="${ax2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="$#,##0" sourceLinked="0"/><c:crossAx val="${ax1}"/><c:crosses val="autoZero"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`);
    drawings.push(`<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${spec.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${spec.row + 15}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 1}" name="${spec.title}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
  });
  files["xl/drawings/drawing1.xml"] = strToU8(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${drawings.join("")}</xdr:wsDr>`);
  const rels = (entries: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
  files["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(rels(specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("")));
  files["xl/worksheets/_rels/sheet5.xml.rels"] = strToU8(rels('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'));
  files["xl/worksheets/sheet5.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet5.xml"]).replace("</worksheet>", '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>'));
  files["[Content_Types].xml"] = strToU8(strFromU8(files["[Content_Types].xml"]).replace("</Types>", `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${specs.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")}</Types>`));
  return zipSync(files, { level: 6 });
}

export function writeBusinessWorkbook(count = 500, year = 2025): Uint8Array {
  const sheets = buildBusinessSheets(count, year);
  return addCharts(writeXlsx(sheets, { freezeHeader: true, autoFilter: true }), sheets);
}

export function businessSalesCsv(count = 500, year = 2025): Uint8Array {
  const rows = buildBusinessSheets(count, year)[0].rows;
  const csv = rows.map((r, ri) => r.map((c, ci) => {
    const value = ri && ci === 1 ? new Date((val(c) - 25569) * 86400000).toISOString().slice(0, 10) : c && typeof c === "object" ? val(c) : c;
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  return strToU8(csv);
}