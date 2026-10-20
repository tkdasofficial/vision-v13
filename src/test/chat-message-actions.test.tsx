import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatMessage from "@/components/chat-message";
import type { ChatMessage as Reply } from "@/lib/types";

vi.mock("@/components/job-card", () => ({ default: () => null }));
const reply: Reply = { id: "answer", role: "assistant", content: "The entire finished answer.", timestamp: new Date(), activity: { seconds: 2, steps: [] } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("completed response controls", () => {
  it("copies the final answer only after the partial reveal ends", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { rerender } = render(<ChatMessage message={{ ...reply, content: "The entire", responsePending: true }} />);
    expect(screen.queryByRole("button", { name: "Copy", exact: true })).toBeNull();
    rerender(<ChatMessage message={reply} />);
    const copy = await screen.findByRole("button", { name: "Copy", exact: true });
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(reply.content));
  });
  it("queues speech and lets the user stop it", async () => {
    const speak = vi.fn(); const cancel = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    render(<ChatMessage message={reply} />);
    fireEvent.click(screen.getByRole("button", { name: "Speak", exact: true }));
    expect(speak.mock.calls[0][0].text).toBe(reply.content);
    fireEvent.click(screen.getByRole("button", { name: "Stop speaking", exact: true }));
    expect(cancel).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
  it("shares the complete reply and falls back to copying when native sharing is denied", async () => {
    const share = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ChatMessage message={reply} />);
    fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(reply.content));
    expect(share).toHaveBeenCalledWith({ title: "Vision reply", text: reply.content });
  });
  it("never shows the four footer actions for failed responses", () => {
    render(<ChatMessage message={{ ...reply, activity: { seconds: 1, steps: [], failed: true } }} />);
    expect(screen.queryByLabelText("Reply actions")).toBeNull();
  });
});