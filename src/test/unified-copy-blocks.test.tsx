import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownReply from "@/components/chat/markdown-reply";
import { codeLanguageLabel } from "@/lib/code-language-label";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Shared copy block behavior", () => {
  it("preserves formatted Markdown copying and literal text and code copying independently", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownReply>{"```markdown\nHello **Sam**.\n```\n\n```text\n# Keep **symbols**\n```\n\n```html\n<h1>Hello</h1>\n```"}</MarkdownReply>);
    fireEvent.click(within(screen.getByRole("region", { name: "Markdown copy box" })).getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Hello Sam."));
    fireEvent.click(within(screen.getByRole("region", { name: "Text copy box" })).getByRole("button", { name: "Copy Text" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("# Keep **symbols**"));
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("<h1>Hello</h1>"));
  });

  it("opens the complete long text rather than only the clipped preview", () => {
    const text = Array.from({ length: 100 }, (_, n) => `Line ${n + 1}`).join("\n");
    render(<MarkdownReply>{`\x60\x60\x60text\n${text}\n\x60\x60\x60`}</MarkdownReply>);
    fireEvent.click(screen.getByRole("button", { name: "Open code full screen" }));
    expect(screen.getByLabelText("Code content")).toHaveTextContent("Line 100");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retains literal text without enabling HTML preview", () => {
    render(<MarkdownReply>{"```text\n<h1>Literal HTML example</h1>\n```"}</MarkdownReply>);
    expect(screen.queryByRole("button", { name: "Preview code" })).toBeNull();
  });

  it("keeps Markdown copying clean in the expanded viewer too", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownReply>{"```markdown\nHello **Sam**.\n```"}</MarkdownReply>);
    fireEvent.click(screen.getByRole("button", { name: "Open code full screen" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Copy$/ }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Hello Sam."));
  });

  it.each([["md", "Markdown"], ["html", "HTML"], ["csv", "CSV"], ["yml", "YAML"], ["txt", "Text"]])("resolves %s to its format name", (language, name) => {
    expect(codeLanguageLabel(language)).toBe(name);
  });
});