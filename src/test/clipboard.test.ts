import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

afterEach(() => vi.restoreAllMocks());
describe("clipboard compatibility", () => {
  it("copies the whole supplied response using the native API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await copyToClipboard("Story\nPrompts\nDialogues");
    expect(writeText).toHaveBeenCalledWith("Story\nPrompts\nDialogues");
  });
  it("falls back when preview permissions reject clipboard access and restores focus", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) } });
    const button = document.createElement("button"); document.body.appendChild(button); button.focus();
    const exec = vi.fn(() => { expect((document.activeElement as HTMLTextAreaElement).value).toBe("Entire final answer"); return true; });
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    await copyToClipboard("Entire final answer");
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.activeElement).toBe(button);
    expect(document.querySelector("textarea")).toBeNull(); button.remove();
  });
  it("reports failure instead of claiming success when both mechanisms fail", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    await expect(copyToClipboard("Answer")).rejects.toThrow("blocked");
    expect(document.querySelector("textarea")).toBeNull();
  });
});