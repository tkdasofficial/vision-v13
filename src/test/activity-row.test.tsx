// Activity row UI: collapsed "Worked for Ns" that expands to the real step history.
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatMessage from "@/components/chat-message";

const base = { id: "1", role: "assistant", content: "Here is your answer.", timestamp: new Date() } as any;

describe("activity row", () => {
  it("shows the real duration collapsed, history hidden by default", () => {
    render(<ChatMessage message={{ ...base, activity: { seconds: 12, steps: ["Thinking", "Writing"] } }} />);
    expect(screen.getByText("Worked for 12s")).toBeTruthy();
    expect(screen.queryByText("Thinking")).toBeNull();
  });
  it("expands to the step history on click", () => {
    render(<ChatMessage message={{ ...base, activity: { seconds: 12, steps: ["Thinking", "Searching", "Writing"] } }} />);
    fireEvent.click(screen.getByText("Worked for 12s"));
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Searching")).toBeTruthy();
    expect(screen.getByText("Writing")).toBeTruthy();
  });
  it("uses the saved question-to-reply duration for older replies without activity", () => {
    render(<ChatMessage message={base} fallbackSeconds={7} />);
    expect(screen.getByText("Worked for 7s")).toBeTruthy();
  });
  it("sits above the reply text, not below it", () => {
    const { container } = render(<ChatMessage message={{ ...base, activity: { seconds: 12, steps: ["Thinking"] } }} />);
    const row = screen.getByText("Worked for 12s").closest("div")!;
    const reply = screen.getByText("Here is your answer.");
    expect(row.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
