import { fireEvent, render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSearch } from "@/lib/navigation-motion";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), rename: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null, profile: null }) }));
vi.mock("@/lib/cloud/client", () => ({ supabase: {} }));
vi.mock("@/context/ChatHistoryContext", () => ({ useChatHistory: () => ({ history: [{ id: "chat-1", title: "Design notes" }, { id: "chat-2", title: "Project chat", projectId: "project-1" }], renameChat: mocks.rename, deleteChat: mocks.remove, getChatById: () => undefined, togglePin: vi.fn(), setChatProject: vi.fn() }) }));
vi.mock("@/components/sidebar-features", () => ({ default: () => <nav aria-label="Workspace features">Library · Projects · Plugins</nav> }));
import AppDrawer, { AppDrawerView } from "@/components/app-drawer";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AppDrawer", () => {
  it("renders a fullscreen page surface, not a dialog, with no separator", () => {
    const close = vi.fn();
    const { container } = render(<AppDrawer onClose={close} onNewChat={vi.fn()} onSelectChat={vi.fn()} />);
    expect(container.firstChild).toHaveClass("h-[100dvh]", "w-full");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close app drawer" }));
    expect(close).toHaveBeenCalled();
  });
  it("keeps recent chat selection, rename, delete and settings", () => {
    const select = vi.fn(); const close = vi.fn();
    render(<AppDrawerView onClose={close} onNewChat={vi.fn()} onSelectChat={select} />);
    expect(screen.queryByText("Project chat")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Design notes" }));
    expect(select).toHaveBeenCalledWith("chat-1");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const openMenu = () => { const t = screen.getByRole("button", { name: "Options for Design notes" }); fireEvent.pointerDown(t, { button: 0, ctrlKey: false }); fireEvent.keyDown(t, { key: "Enter" }); };
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Chat title" }), { target: { value: "Updated notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save chat title" }));
    expect(mocks.rename).toHaveBeenCalledWith("chat-1", "Updated notes");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("chat-1");
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/settings");
  });
  it("embeds search and returns to navigation without page navigation", async () => {
    const close = vi.fn();
    const { container } = render(<AppDrawerView onClose={close} onNewChat={vi.fn()} onSelectChat={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search workspace" }));
    const search = screen.getByRole("searchbox", { name: "Search anything" });
    expect(search).toHaveFocus();
    // The drawer content plays its exit animation before unmounting.
    expect(screen.getByRole("button", { name: "Search workspace" }).closest("header")).toHaveClass("drawer-pane-out");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Search workspace" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Vision" })).not.toBeInTheDocument();
    const filters = screen.getByRole("tablist", { name: "Search categories" });
    expect(search.closest(".drawer-top")).toHaveClass("relative");
    expect(search.closest(".drawer-top")).toHaveClass("col-start-1", "row-start-1", "self-start");
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).toHaveClass("col-start-1", "row-start-1");
    if (!scroller) throw new Error("Missing search scroller");
    fireEvent.scroll(scroller, { target: { scrollTop: 80 } });
    expect(container.firstChild).toHaveAttribute("data-scrolled", "true");
    fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
    expect(container.firstChild).toHaveAttribute("data-scrolled", "false");
    expect(search).toHaveClass("drawer-floating");
    expect(screen.getByRole("button", { name: "Back to drawer" })).toHaveClass("drawer-floating");
    for (const filter of screen.getAllByRole("tab")) expect(filter).toHaveClass("drawer-floating", "drawer-filter");
    expect(search.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(search, { target: { value: "Design" } });
    expect(search).toHaveValue("Design");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Uploaded Files" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("tab", { name: "Uploaded Files" })).toHaveAttribute("data-state", "active");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Back to drawer" }));
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("opens the preserved direct search entry and returns to the drawer UI", () => {
    render(<AppDrawerView initialSearch onClose={vi.fn()} onNewChat={vi.fn()} onSelectChat={vi.fn()} />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to drawer" }));
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search workspace" })).toBeInTheDocument();
  });
  it("morphs into Search on a pull-down request, like the Search button", () => {
    render(<AppDrawerView onClose={vi.fn()} onNewChat={vi.fn()} onSelectChat={vi.fn()} />);
    act(() => { expect(requestSearch()).toBe(true); });
    expect(screen.getByRole("searchbox", { name: "Search anything" })).toBeInTheDocument();
    // The drawer content plays its exit animation before unmounting.
    expect(screen.getByRole("button", { name: "Search workspace" }).closest("header")).toHaveClass("drawer-pane-out");
  });
  it("returns to the triggering page when Search was opened by a pull-down from Chat", () => {
    const back = vi.fn();
    render(<AppDrawerView initialSearch onSearchBack={back} onClose={vi.fn()} onNewChat={vi.fn()} onSelectChat={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to drawer" }));
    expect(back).toHaveBeenCalled();
    // No morph back to the drawer: the overlay closes straight onto Chat.
    expect(screen.queryByRole("button", { name: "Search workspace" })).not.toBeInTheDocument();
  });
});