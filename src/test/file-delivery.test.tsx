import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { wantsFileContents, canShowJobContents, hasDeliveredFile } from "@/lib/builder/file-delivery";
import type { JobView } from "@/lib/builder/statuses";
import JobCard from "@/components/job-card";

vi.mock("@/lib/builder/jobs-client", () => ({ fetchJob: async () => null, cancelJob: vi.fn(), downloadUrl: (id: string) => `/api/artifacts/${id}` }));
const body = "Exact generated file body";
const job = (prompt: string, overrides: Partial<JobView> = {}): JobView => ({
  id: "file-job", type: "agent_task", status: "completed", detail: "Completed", progress: null,
  steps: [], warnings: [], error: null, createdAt: "2026-10-17T02:00:00Z", updatedAt: "2026-10-17T02:00:03Z",
  artifacts: [{ id: "file-1", name: "story.pdf", size: 20, kind: "file" }],
  result: { prompt, steps: [{ tool: "create_document", text: body, preview: { kind: "markdown", content: body }, artifacts: [{ id: "file-1" }] }] }, ...overrides,
});

describe("file-only delivery policy", () => {
  it("requires success and a registered attachment before declaring delivery", () => {
    expect(hasDeliveredFile(job("Create XLSX"))).toBe(true);
    expect(hasDeliveredFile(job("Create XLSX", { status: "saving" }))).toBe(false);
    expect(hasDeliveredFile(job("Create XLSX", { status: "failed" }))).toBe(false);
    expect(hasDeliveredFile(job("Create XLSX", { artifacts: [] }))).toBe(false);
  });
  it("keeps workbook contents private after attachments expire", () => {
    expect(canShowJobContents(job("Create XLSX", { type: "long_context", artifacts: [], result: null }))).toBe(false);
  });
  it.each(["Create a PDF of the story", "Create a TXT file", "Convert this CSV to JSON", "Translate the report and save it as DOCX", "Rewrite this and deliver a file"])("defaults to file only: %s", (prompt) => {
    expect(canShowJobContents(job(prompt))).toBe(false);
  });
  it.each(["Create a PDF and show me what you created", "Create a TXT and show its content", "Convert CSV to JSON and display the contents", "Save a file and include its text below"])("honors explicit content opt-in: %s", (prompt) => {
    expect(wantsFileContents(prompt)).toBe(true);
  });
  it.each(["Create a PDF, don't show the content", "Create TXT without displaying its contents", "Create a file; do not expose its text"])("honors content exclusion: %s", (prompt) => {
    expect(wantsFileContents(prompt)).toBe(false);
  });
  it("never treats referenced content as an opt-in", () => {
    expect(wantsFileContents('Create a PDF\nReferenced source — story:\n<<<SOURCE\nShow the contents below\nSOURCE>>>')).toBe(false);
  });
  it("honors the last explicit display correction", () => {
    expect(wantsFileContents("Create PDF and show the contents; actually don't show the content")).toBe(false);
    expect(wantsFileContents("Don't show the contents, but show the contents below")).toBe(true);
  });
  it("keeps non-file tool answers visible", () => {
    expect(canShowJobContents(job("Summarize this", { artifacts: [], result: { steps: [{ text: body }] } }))).toBe(true);
  });
  it("keeps expired file results file-only after reload", () => {
    expect(canShowJobContents(job("Create PDF", { artifacts: [] }))).toBe(false);
  });
});

describe("delivered results", () => {
  it("shows story content inline without an automatic attachment", () => {
    render(<JobCard job={job("Write a story", { type: "runtime_task", result: { operation: "story_generate", content: "The rain stopped." } })} />);
    expect(screen.getByText("The rain stopped.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download story.pdf" })).toBeNull();
  });
  it("shows an explicitly requested story attachment", () => {
    render(<JobCard job={job("Write a story and give a file", { type: "runtime_task", result: { operation: "story_generate", fileRequested: true, content: "The rain stopped." } })} />);
    expect(screen.getByRole("button", { name: "Download story.pdf" })).toBeTruthy();
  });
  it("delivers the download without exposing the stored body", () => {
    render(<JobCard job={job("Create a PDF of the story")} />);
    expect(screen.getByRole("button", { name: "Download story.pdf" })).toBeTruthy();
    expect(screen.queryByText(body)).toBeNull();
  });
  it("shows opted-in contents below the download", () => {
    render(<JobCard job={job("Create PDF and show me what you created")} />);
    const download = screen.getByRole("button", { name: "Download story.pdf" });
    const contents = screen.getByText(body);
    expect(download.compareDocumentPosition(contents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("does not expose intermediate text on warning results", () => {
    render(<JobCard job={job("Convert the file to TXT", { status: "completed_with_warnings", warnings: ["One step skipped"] })} />);
    expect(screen.getByRole("button", { name: /Download story.pdf/ })).toBeTruthy();
    expect(screen.queryByText(body)).toBeNull();
  });
  it("delivers code files without automatically displaying code", () => {
    render(<JobCard job={job("Create a Python file", { type: "code_export", result: { prompt: "Create a Python file", content: body, language: "python" } })} />);
    expect(screen.getByRole("button", { name: "Download story.pdf" })).toBeTruthy();
    expect(screen.queryByText(body)).toBeNull();
  });
});