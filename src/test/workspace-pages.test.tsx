import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FloatingWorkspacePage from "@/components/floating-workspace-page";
import { Button } from "@/components/ui/button";
import { requestProjectsSearch } from "@/lib/navigation-motion";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Fixture() {
  const [query, setQuery] = useState("");
  return <FloatingWorkspacePage title="Projects" query={query} onQueryChange={setQuery} pullDownSearch actions={<Button onClick={() => mocks.navigate("/projects/new")} aria-label="Create project">+</Button>}>
    {["Website", "Research"].filter((name) => name.toLowerCase().includes(query.toLowerCase())).map((name) => <p key={name}>{name}</p>)}
  </FloatingWorkspacePage>;
}

describe("Workspace page navigation and project search", () => {
  it("filters projects with top search and restores all projects when returning", () => {
    render(<Fixture />);
    act(() => { expect(requestProjectsSearch(screen.getByText("Website"))).toBe(true); });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "web" } });
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.queryByText("Research")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Projects" }));
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("does not open Projects search from a different page", () => {
    render(<><p>Chat content</p><Fixture /></>);
    act(() => { expect(requestProjectsSearch(screen.getByText("Chat content"))).toBe(false); });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
  it("returns to drawer and preserves the create-project destination", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/projects/new");
    fireEvent.click(screen.getByRole("button", { name: "Back to drawer" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/drawer");
  });
});