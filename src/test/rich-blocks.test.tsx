import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MarkdownReply from "@/components/chat/markdown-reply";

describe("rich structured replies", () => {
  it("renders callouts, flow diagrams and safe links in one reply", () => {
    const md = "## Plan\n\n1. Step one\n2. Step two\n\n> [!WARNING]\n> Back up first.\n\n```flow\nAnalyzer — reads the request\nGenerator — writes the answer\n```\n\n[bad](javascript:alert(1)) [good](https://example.com)";
    const { container } = render(<MarkdownReply>{md}</MarkdownReply>);
    expect(screen.getByRole("note", { name: "Warning" }).textContent).toContain("Back up first.");
    expect(screen.getByRole("note").textContent).not.toContain("[!WARNING]");
    expect(screen.getByLabelText("Flow").querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("reads the request")).toBeTruthy();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://example.com"]);
  });
});
