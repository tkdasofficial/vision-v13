import { describe, it, expect } from "vitest";
import { WORKFLOWS, pickWorkflow } from "@/lib/runtime/workflows";

describe("runtime workflow routing", () => {
  it("has 20 one-word workflows on 19 workers (terminal aliases logs)", () => {
    expect(Object.keys(WORKFLOWS)).toHaveLength(20);
    for (const k of Object.keys(WORKFLOWS)) expect(k).toMatch(/^[a-z]+$/);
    expect(new Set(Object.values(WORKFLOWS).map((w) => w.worker)).size).toBe(19);
    for (const [k, w] of Object.entries(WORKFLOWS)) expect(w.worker).toBe(k === "terminal" ? "logs" : k);
  });
  it("routes prompt series to prompts.yml and never picks terminal", () => {
    expect(pickWorkflow("prompt_generate", undefined)).toBe("prompts");
    expect(pickWorkflow("checksum", "", "blob.xyz")).toBe("logs");
  });
  it("routes story jobs to prompts.yml", () => expect(pickWorkflow("story_generate", undefined)).toBe("prompts"));
  it("routes office conversions by source family", () => {
    expect(pickWorkflow("office_convert", "docx")).toBe("documents");
    expect(pickWorkflow("office_convert", "xlsx")).toBe("spreadsheets");
    expect(pickWorkflow("office_convert", "pptx")).toBe("presentations");
  });
  it("routes renders by diagram language", () => {
    expect(pickWorkflow("render", "tex")).toBe("documents");
    expect(pickWorkflow("render", "mmd")).toBe("diagrams");
    expect(pickWorkflow("render", "dot")).toBe("diagrams");
    expect(pickWorkflow("render", "puml")).toBe("diagrams");
    expect(pickWorkflow("render", "dxf")).toBe("diagrams");
    expect(pickWorkflow("render", "svg")).toBe("diagrams");
  });
  it("routes data by source", () => {
    expect(pickWorkflow("data_convert", "sqlite")).toBe("data");
    expect(pickWorkflow("data_convert", "shp")).toBe("maps");
    expect(pickWorkflow("data_convert", "csv")).toBe("data");
    expect(pickWorkflow("archive_convert", "cbz")).toBe("archives");
  });
  it("routes checksums by file name, falling back to logs", () => {
    expect(pickWorkflow("checksum", "", "subs.srt")).toBe("subtitles");
    expect(pickWorkflow("checksum", "", "a.ics")).toBe("calendars");
    expect(pickWorkflow("checksum", "", "blob.xyz")).toBe("logs");
  });
  it("refuses an op no workflow handles for that source", () => expect(pickWorkflow("render", "xlsx")).toBeNull());
});
