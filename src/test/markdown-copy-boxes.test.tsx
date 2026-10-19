import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownReply from "@/components/chat/markdown-reply";
import { systemPromptFor } from "@/lib/ai/prompts.server";
import { classifyTask } from "@/lib/ai/task-router";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Markdown writing copy boxes", () => {
  it("keeps explanations outside one prompt box and copies only the prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownReply>{"Here is your prompt.\n\n```markdown\nWrite a **clear** story.\n```\n\nUse it as written."}</MarkdownReply>);
    const box = screen.getByRole("region", { name: "Markdown copy box" });
    expect(box).toHaveTextContent("Write a clear story.");
    expect(box).not.toHaveTextContent("**");
    expect(box).not.toHaveTextContent("Here is your prompt.");
    fireEvent.click(within(box).getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Write a clear story."));
    expect(within(box).getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("renders two independently copyable prompts in one reply", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownReply>{"## Prompt 1\n\n```markdown\nFirst prompt.\n```\n\nSecond explanation.\n\n## Prompt 2\n\n```markdown\nSecond prompt.\n```\n\nClosing text."}</MarkdownReply>);
    const boxes = screen.getAllByRole("region", { name: "Markdown copy box" });
    expect(boxes).toHaveLength(2);
    fireEvent.click(within(boxes[1]).getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("Second prompt."));
    expect(within(boxes[0]).getByRole("button", { name: "Copy Markdown" })).toBeInTheDocument();
    fireEvent.click(within(boxes[0]).getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("First prompt."));
    expect(screen.getByText("Closing text.")).toBeInTheDocument();
  });

  it("supports single-line untagged fences, tilde fences and partial streamed fences", () => {
    const { rerender } = render(<MarkdownReply>{"```\nA single sentence.\n```\n\n~~~text\nAnother sentence.\n~~~"}</MarkdownReply>);
    expect(screen.getAllByRole("region", { name: "Text copy box" })).toHaveLength(2);
    rerender(<MarkdownReply>{"```markdown\nStill writing"}</MarkdownReply>);
    expect(screen.getByRole("region", { name: "Markdown copy box" })).toHaveTextContent("Still writing");
    rerender(<MarkdownReply>{"```markdown\nStill writing a full prompt.\n```"}</MarkdownReply>);
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("preserves nested fences and keeps inline and programming code out of prose boxes", () => {
    render(<MarkdownReply>{"Use `short text` inline.\n\n````markdown\n# Template\n```js\nconst a = 1;\n```\n````\n\n```python\nprint('hello')\n```"}</MarkdownReply>);
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region")).toHaveTextContent("const a = 1;");
    const viewers = Array.from(document.querySelectorAll(".content-block-body"));
    expect(viewers[viewers.length - 1]).toHaveTextContent("print('hello')");
    expect(screen.getByText("short text").tagName).toBe("CODE");
  });

  it.each(["default", "deep", "research", "coding"] as const)("instructs %s mode to separate prompts from explanations", (mode) => {
    const prompt = systemPromptFor(classifyTask({ text: "Write two prompts", mode, hasMedia: false }));
    expect(prompt).toContain("Give each requested prompt its own separate fenced block");
    expect(prompt).toContain("explanations and closing remarks outside the fences");
    expect(prompt).toContain("Respect explicit requests for a different output format");
  });
});