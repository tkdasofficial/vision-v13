import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import FullScreenCodeView from "@/components/chat/full-screen-code-view";
import CodeSource from "@/components/chat/code-source";
import PreviewPane from "@/components/chat/preview-pane";
import { codeLanguageLabel } from "@/lib/code-language-label";

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const code = '<!doctype html>\n<h1>Hello</h1>\n<p>Hello again</p>\n<button onclick="this.textContent=\'Clicked\'">Test</button>';

describe("Advanced code viewer", () => {
  it("labels languages and places the mobile preview toggle before download and copy", () => {
    expect(codeLanguageLabel("html")).toBe("HTML");
    expect(codeLanguageLabel("javascript")).toBe("JavaScript");
    expect(codeLanguageLabel("cpp")).toBe("C++");
    render(<FullScreenCodeView code={code} language="html" onClose={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: "Preview" });
    expect(toggle.parentElement?.querySelectorAll("button")[1]).toHaveAccessibleName("Download code.html");
    fireEvent.click(toggle);
    expect(screen.getByTitle("code.html preview")).toHaveAttribute("sandbox", "allow-scripts");
    fireEvent.click(screen.getByRole("button", { name: "Show code" }));
    expect(screen.getByLabelText("Code content")).toBeInTheDocument();
  });
  it("opens searchable numbered source and navigates matching lines", async () => {
    render(<FullScreenCodeView code={code} language="html" filename="index.html" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("index.html");
    expect(document.querySelectorAll("[data-code-line]")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Find in code" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search code" }), { target: { value: "hello" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 / 2 lines");
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 / 2 lines");
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 / 2 lines");
    fireEvent.change(screen.getByRole("textbox", { name: "Search code" }), { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
  });

  it("toggles wrapping and line numbers and zooms without changing copied content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<FullScreenCodeView code={code} language="html" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
    expect(screen.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Line numbers" }));
    expect(screen.getByRole("button", { name: "Line numbers" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("108%");
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  });

  it("offers split preview for HTML but never claims arbitrary code is runnable", () => {
    const { unmount } = render(<FullScreenCodeView code={code} language="html" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "split view" }));
    expect(screen.getByLabelText("Code content")).toBeInTheDocument();
    expect(screen.getByTitle("code.html preview")).toHaveAttribute("sandbox", "allow-scripts");
    unmount();
    render(<FullScreenCodeView code="print('Hello')" language="python" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "preview view" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "split view" })).toBeDisabled();
  });

  it("changes preview sizes, reloads only the frame and reports load errors", async () => {
    render(<PreviewPane html={code} />);
    const frame = screen.getByTitle("Code preview");
    fireEvent.load(frame);
    expect(screen.getByRole("status")).toHaveTextContent("Preview ready");
    fireEvent.click(screen.getByRole("button", { name: "mobile preview" }));
    expect(screen.getByText("375 px")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
    expect(screen.getByTitle("Code preview")).not.toBe(frame);
    fireEvent.load(screen.getByTitle("Code preview"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preview ready"));
    fireEvent.error(screen.getByTitle("Code preview"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Preview could not load"));
    fireEvent.click(screen.getByRole("button", { name: "Reload preview" }));
    expect(screen.getByTitle("Code preview")).toBeInTheDocument();
  });

  it("escapes code instead of executing markup in the source pane", () => {
    render(<CodeSource code={'<script>alert("bad")</script>\n<img src=x onerror=alert(1)>'} language="html" />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.body).toHaveTextContent('<script>alert("bad")</script>');
  });
});