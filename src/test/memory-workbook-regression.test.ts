import { describe, it, expect, vi } from "vitest";
import { restoreConversationHistory } from "@/lib/ai/conversation-history";
import { resolveReference, type ConvMsg } from "@/lib/ai/references";
import { detectMemoryRequest, relevantMemories, planMemoryWrite } from "@/lib/ai/memory";
import { routeRequest } from "@/lib/ai/request-route";
import { buildBusinessSheets, writeBusinessWorkbook } from "@/lib/jobs/business-workbook";
import { readXlsx, type FormulaCell } from "@/lib/tools/office";
import { unzipSync, strFromU8 } from "fflate";

const brief = 'Create a professional Excel workbook named "Business_Performance_Analysis.xlsx": Sales_Data: 500 fictional sales transactions. Regional_Analysis, Product_Analysis, Monthly_Trends and Dashboard. Dates January–December 2025.';
const history: ConvMsg[] = [
  { role: "user", content: brief },
  { id: "original", role: "assistant", content: "Sales_Data Regional_Analysis Product_Analysis Monthly_Trends Dashboard workbook specification" },
  { role: "user", content: 'Deliver a functional ".xlsx" workbook. Of this Webbook, Don\'t Care New.' },
  { id: "refusal", role: "assistant", content: "I'm unable to create binary files. Here are instructions instead." },
];

describe("latest conversation regression", () => {
  it("first generation means the original response, not the later refusal", () => {
    expect(resolveReference("I am asking about the first generation, use Memory to understand what I want. Create CSV.", history)).toMatchObject({ kind: "found", id: "original" });
  });
  it("Webbook resolves the actual workbook even after a refusal", () => {
    expect(resolveReference("Try To create CSV of the Webbook.", history)).toMatchObject({ kind: "found", id: "original" });
  });
  it("restores persisted history before resolving references without duplicate turns", () => {
    const current: ConvMsg = { role: "user", content: "Create CSV of the first generation" };
    const restored = restoreConversationHistory(history, [...history.slice(-2), current]);
    expect(restored).toHaveLength(5);
    expect(resolveReference(String(current.content), restored.slice(0, -1))).toMatchObject({ id: "original" });
  });
  it("keeps a genuinely repeated question when it is not a saved suffix", () => {
    const question: ConvMsg = { role: "user", content: "What is my favorite color?" };
    const saved: ConvMsg[] = [question, { role: "assistant", content: "Teal." }];
    expect(restoreConversationHistory(saved, [question])).toHaveLength(3);
  });
  it.each(["default", "deep", "coding", "research"] as const)("native workbook delivery runs in %s mode", (mode) => {
    expect(routeRequest(brief, mode)).toEqual({ kind: "long_context" });
  });
});

describe("permanent memory retrieval", () => {
  it("recognizes explicit permanent-memory storage", () => {
    expect(detectMemoryRequest("Save in permanent memory: my favorite color is teal")).toEqual({ action: "save", content: "my favorite color is teal" });
  });
  it("chat-only memory never becomes permanent memory", () => {
    expect(detectMemoryRequest("Remember only in this chat: my code word is Falcon")).toEqual({ action: "none" });
  });
  it("retrieves common spelling variants and persists preferences across unrelated questions", () => {
    const memories = [{ id: "color", content: "my favorite color is teal", createdAt: 1 }, { id: "preference", content: "I prefer concise answers", createdAt: 2 }];
    expect(relevantMemories(memories, "What is my favourite shade?").map((m) => m.id)).toContain("color");
    expect(relevantMemories(memories, "Explain gravity").map((m) => m.id)).toEqual(["preference"]);
    expect(planMemoryWrite(memories, "My favourite colour is blue")).toMatchObject({ kind: "replace", id: "color" });
  });
});

describe("functional business workbook", () => {
  const value = (v: unknown) => Number((v as FormulaCell)?.value ?? v);
  it("delivers five worksheets, 500 sales records, and all twelve 2025 months", () => {
    const sheets = readXlsx(writeBusinessWorkbook(500, 2025));
    expect(sheets.map((s) => s.name)).toEqual(["Sales_Data", "Regional_Analysis", "Product_Analysis", "Monthly_Trends", "Dashboard"]);
    expect(sheets[0].rows).toHaveLength(501);
    const months = new Set(sheets[0].rows.slice(1).map((r) => new Date((Number(r[1]) - 25569) * 86400000).toISOString().slice(0, 7)));
    expect([...months]).toEqual(Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`));
  });
  it("revenue and profit use the exact requested calculations", () => {
    for (const r of buildBusinessSheets(500)[0].rows.slice(1)) {
      expect(value(r[8])).toBeCloseTo(value(r[5]) * value(r[6]) * (1 - value(r[7])), 8);
      expect(value(r[10])).toBeCloseTo(value(r[8]) - value(r[9]), 8);
      expect((r[8] as FormulaCell).formula).toMatch(/^F\d+\*G\d+\*\(1-H\d+\)$/);
      expect((r[10] as FormulaCell).formula).toMatch(/^I\d+-J\d+$/);
    }
  });
  it("regional, product and monthly totals reconcile with source transactions", () => {
    const sheets = buildBusinessSheets();
    const total = sheets[0].rows.slice(1).reduce((s, r) => s + value(r[8]), 0);
    for (const sheet of sheets.slice(1, 4)) expect(sheet.rows.slice(1).reduce((s, r) => s + value(r[1]), 0)).toBeCloseTo(total, 6);
    for (const r of sheets[1].rows.slice(1)) expect(value(r[4])).toBeCloseTo(value(r[3]) / value(r[1]), 8);
  });
  it("contains real formulas and three native linked Excel charts", () => {
    const files = unzipSync(writeBusinessWorkbook());
    const dashboard = strFromU8(files["xl/worksheets/sheet5.xml"]);
    expect(dashboard).toContain("INDEX(Product_Analysis!");
    expect(Object.keys(files).filter((k) => /^xl\/charts\/chart\d+\.xml$/.test(k))).toHaveLength(3);
    expect(strFromU8(files["xl/charts/chart1.xml"])).toContain("'Regional_Analysis'!B2:B7");
    expect(strFromU8(files["xl/charts/chart2.xml"])).toContain("'Dashboard'!D2:D11");
    expect(strFromU8(files["xl/charts/chart3.xml"])).toContain("'Monthly_Trends'!B2:B13");
  });
});