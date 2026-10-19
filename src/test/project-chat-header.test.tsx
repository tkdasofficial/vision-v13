import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/router-compat", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/cloud/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p1", name: "Quarterly research review board", pinned: false } }) }) }) }) }) } }));
vi.mock("@/components/project-menu/use-project-actions", () => ({ useProjectActions: () => ({ actionsFor: () => ({ onNewChat: () => mocks.navigate("/chat?project=p1"), onTogglePin: vi.fn(), onShare: vi.fn(), onEdit: mocks.edit, onInstructions: vi.fn(), onDelete: vi.fn() }), dialog: null }) }));
import ProjectChatHeader from "@/components/project-chat-header";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Project chat actions", () => {
  it("offers only project actions and no Incognito", async () => {
    render(<ProjectChatHeader projectId="p1" />);
    const trigger = await screen.findByRole("button", { name: "Options for Quarterly research review board" });
    expect(screen.getByRole("heading")).toHaveTextContent("Quarterly research...");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const edit = await screen.findByRole("menuitem", { name: "Edit project" });
    expect(screen.queryByRole("button", { name: /incognito/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Add to project" })).not.toBeInTheDocument();
    fireEvent.click(edit);
    expect(mocks.edit).toHaveBeenCalledOnce();
  });
});