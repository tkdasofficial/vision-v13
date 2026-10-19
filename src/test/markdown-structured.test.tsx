import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownReply from "@/components/chat/markdown-reply";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const source = "# Blueprint\n\n> [!WARNING]\n> Keep the door shut.\n\n| Scene | Clue |\n| --- | --- |\n| 1 | Brass key |\n| 2 | Broken seal |\n\n```flow\nArrival — find the key\nDiscovery — break the seal\n```\n\n- [x] Arrive\n- [ ] Investigate\n\n\\[x^2 + y^2 = z^2\\]\n\n[Source](https://example.com) [unsafe](javascript:alert(1))";

describe("Structured Markdown deliverables", () => {
  it("preserves structured data and clean copying in one deliverable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownReply>{`\x60\x60\x60\x60markdown\n${source}\n\x60\x60\x60\x60`}</MarkdownReply>);
    const box = screen.getByRole("region", { name: "Markdown copy box" });
    expect(within(box).getByRole("note", { name: "Warning" })).toHaveTextContent("Keep the door shut.");
    expect(within(box).getAllByRole("row")).toHaveLength(3);
    expect(within(box).getByRole("cell", { name: "Brass key" })).toBeInTheDocument();
    expect(within(box).getByLabelText("Flow").querySelectorAll("li")).toHaveLength(2);
    expect(within(box).getAllByRole("checkbox").map((input) => (input as HTMLInputElement).checked)).toEqual([true, false]);
    expect(box.querySelector(".katex-display")).toBeTruthy();
    expect(within(box).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["https://example.com"]);
    fireEvent.click(within(box).getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("1\tBrass key")));
    expect(writeText.mock.calls[0][0]).toContain("Arrival — find the key");
  });
  it("preserves the complete structures in expanded view", () => {
    render(<MarkdownReply>{`\x60\x60\x60\x60markdown\n${source}\n\x60\x60\x60\x60`}</MarkdownReply>);
    fireEvent.click(screen.getByRole("button", { name: "Open code full screen" }));
    const viewer = within(screen.getByRole("dialog"));
    expect(viewer.getByRole("cell", { name: "Broken seal" })).toBeInTheDocument();
    expect(viewer.getByRole("note", { name: "Warning" })).toHaveTextContent("Keep the door shut.");
    expect(viewer.getByLabelText("Flow").querySelectorAll("li")).toHaveLength(2);
  });
});