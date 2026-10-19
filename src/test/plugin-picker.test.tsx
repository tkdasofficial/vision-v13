import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatInput from "@/components/chat-input";
import { pluginFor } from "@/lib/plugins/manifest";

vi.mock("@/hooks/usePlugins", () => ({ usePlugins: () => ({ added: [pluginFor("pdf"), pluginFor("web-search")], loading: false }) }));
vi.mock("@/components/mode-selector", () => ({ default: () => null }));
afterEach(cleanup);

async function openPlugins() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Add attachment" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Plugins" }));
  return screen.findByRole("dialog", { name: "Added plugins" });
}

describe("attachment plugin picker", () => {
  it("opens from attachments and offers only added plugins without leaving the draft", async () => {
    render(<ChatInput onSend={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep this draft" } });
    await openPlugins();
    expect(screen.getByRole("button", { name: "Select PDF plugin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Web Search plugin" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select DOCX plugin" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select PDF plugin" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
    expect(screen.getByRole("button", { name: "Remove PDF plugin" })).toBeInTheDocument();
  });

  it("sends the selected plugin through the existing chat callback", async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    await openPlugins();
    fireEvent.click(screen.getByRole("button", { name: "Select Web Search plugin" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Find sources" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][4]).toEqual(["web-search"]);
  });
});