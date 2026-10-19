import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AppMotion } from "@/components/app-motion";
import { pageTransitionTypes } from "@/lib/app-motion";

afterEach(() => { cleanup(); document.documentElement.classList.remove("reduce-motion"); vi.restoreAllMocks(); });

describe("page motion", () => {
  it("reverses direction for history back", () => {
    expect(pageTransitionTypes({ fromLocation: { pathname: "/settings", state: { __TSR_index: 2 } }, toLocation: { pathname: "/drawer", state: { __TSR_index: 1 } }, pathChanged: true })).toEqual(["page-back"]);
  });
  it("uses forward motion for a new page", () => {
    expect(pageTransitionTypes({ fromLocation: { pathname: "/drawer" }, toLocation: { pathname: "/settings" }, pathChanged: true })).toEqual(["page-forward"]);
  });
  it("does not animate draft URL adoption or query updates", () => {
    expect(pageTransitionTypes({ fromLocation: { pathname: "/chat" }, toLocation: { pathname: "/chat/saved-id" }, pathChanged: true })).toBe(false);
    expect(pageTransitionTypes({ fromLocation: { pathname: "/chat" }, toLocation: { pathname: "/chat" }, pathChanged: false })).toBe(false);
  });
  it("disables page motion with the user's preference", () => {
    document.documentElement.classList.add("reduce-motion");
    expect(pageTransitionTypes({ fromLocation: { pathname: "/drawer" }, toLocation: { pathname: "/settings" }, pathChanged: true })).toBe(false);
  });
});

describe("tap feedback", () => {
  it("replaces rapid bounce animations and cleans up", () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, onfinish: null }));
    const { getByRole, unmount } = render(<><AppMotion /><button>Tap</button></>);
    const button = getByRole("button");
    Object.defineProperty(button, "animate", { value: animate });
    fireEvent.click(button); fireEvent.click(button);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    unmount(); expect(cancel).toHaveBeenCalledTimes(2);
  });
  it("does not bounce disabled buttons or reduced motion", () => {
    const animate = vi.fn();
    const { getByRole } = render(<><AppMotion /><button disabled>Tap</button></>);
    const button = getByRole("button");
    Object.defineProperty(button, "animate", { value: animate });
    fireEvent.click(button);
    button.removeAttribute("disabled");
    document.documentElement.classList.add("reduce-motion");
    fireEvent.click(button);
    expect(animate).not.toHaveBeenCalled();
  });
});