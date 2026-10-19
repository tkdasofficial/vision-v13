import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownReply from "@/components/chat/markdown-reply";
import { compareTableValues, tableToCsv } from "@/lib/table-export";
import { systemPromptFor } from "@/lib/ai/prompts.server";
import { classifyTask } from "@/lib/ai/task-router";
const driveExport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/drive-export', () => ({ exportToDrive: driveExport }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); driveExport.mockClear(); });
const table = "| Product | Price |\n| :--- | ---: |\n| **Beta** | 20 |\n| Alpha | 3 |";

describe("Advanced chat tables", () => {
  it("renders multiple tables alongside explanations and independent prompt boxes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const second = "| Name | Note |\n| --- | --- |\n| Café | left\\|right |";
    render(<MarkdownReply>{`## Comparison\n\n${table}\n\nAn explanation.\n\n${second}\n\n\x60\x60\x60markdown\nA prompt.\n\x60\x60\x60`}</MarkdownReply>);
    const outputs = screen.getAllByRole("region", { name: "Table output" });
    expect(outputs).toHaveLength(2);
    expect(screen.getByText("An explanation.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Markdown copy box" })).toHaveTextContent("A prompt.");
    expect(within(outputs[0]).getByText("Beta").tagName).toBe("STRONG");
    fireEvent.click(within(outputs[1]).getByRole("button", { name: "Copy table Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(second));
    expect(within(outputs[0]).getByRole("button", { name: "Copy table Markdown" })).toBeInTheDocument();
  });

  it("sorts numerically, reverses and restores original ordering without changing source copying", () => {
    render(<MarkdownReply>{table}</MarkdownReply>);
    const button = screen.getByRole("button", { name: "Sort by Price" });
    const first = () => screen.getAllByRole("row")[1];
    expect(first()).toHaveTextContent("Beta");
    fireEvent.click(button);
    expect(first()).toHaveTextContent("Alpha");
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(button);
    expect(first()).toHaveTextContent("Beta");
    fireEvent.click(button);
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "none");
  });

  it("updates rows while a reply streams and keeps explicit raw Markdown fenced", () => {
    const { rerender } = render(<MarkdownReply>{"| A | B |\n| --- | --- |"}</MarkdownReply>);
    expect(screen.getByRole("region", { name: "Scrollable table" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1);
    rerender(<MarkdownReply>{"| A | B |\n| --- | --- |\n| One | Two |"}</MarkdownReply>);
    expect(screen.getAllByRole("row")).toHaveLength(2);
    rerender(<MarkdownReply>{`\x60\x60\x60text\n${table}\n\x60\x60\x60`}</MarkdownReply>);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Text copy box" })).toBeInTheDocument();
  });

  it("downloads a UTF-8 CSV in the currently displayed order", () => {
    render(<MarkdownReply>{table}</MarkdownReply>);
    fireEvent.click(screen.getByRole("button", { name: "Sort by Price" }));
    fireEvent.click(screen.getByRole("button", { name: "Download table CSV" }));
    expect(driveExport).toHaveBeenCalledWith(expect.any(Blob), 'vision-table.csv');
    expect(driveExport.mock.calls[0][0].type).toBe('text/csv;charset=utf-8');
  });

  it("escapes CSV quotes and newlines and neutralizes spreadsheet formulas", () => {
    expect(tableToCsv([["Café", 'a,"b"', "line\nbreak"], ["=1+1", " @SUM(A1)", "-20"]])).toBe('"Café","a,""b""","line\nbreak"\r\n"\'=1+1","\' @SUM(A1)","\'-20"');
    expect(compareTableValues("3", "20")).toBeLessThan(0);
    expect(compareTableValues("2%", "15%")).toBeLessThan(0);
    expect(compareTableValues("Item 2", "Item 10")).toBeLessThan(0);
  });

  it.each(["default", "deep", "research", "coding"] as const)("instructs %s mode to produce valid, honest tables", (mode) => {
    const prompt = systemPromptFor(classifyTask({ text: "Make two comparison tables", mode, hasMedia: false }));
    expect(prompt).toContain("consistent column counts");
    expect(prompt).toContain("multiple independent tables");
    expect(prompt).toContain("do not invent missing data");
  });
});