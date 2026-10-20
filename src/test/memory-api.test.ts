// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ user: "u1" as string | null, denyOrigin: false, list: vi.fn(), edit: vi.fn(), remove: vi.fn(), switches: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/cloud/api-proxy.server", () => ({ maybeProxyToWorker: async () => null }));
vi.mock("@/lib/cloud/auth.server", () => ({ getCaller: async () => mock.user ? { user: { id: mock.user } } : null }));
vi.mock("@/lib/cloud/security.server", () => ({ factsFrom: () => ({}), assertSameOrigin: () => { if (mock.denyOrigin) throw new Error("Forbidden origin"); } }));
vi.mock("@/lib/ai/memory.server", () => ({ listMemoryItems: mock.list, editMemory: mock.edit, deletePermanentMemories: mock.remove, setMemorySwitches: mock.switches, loadChatContext: async () => ({ prefsRaw: { savedMemories: false } }) }));
import { Route } from "@/routes/api/memories";
const handlers = (Route as unknown as { server: { handlers: Record<string, (input: { request: Request }) => Promise<Response>> } }).server.handlers;
const call = (method: string, body?: unknown) => handlers[method]({ request: new Request("http://localhost:8080/api/memories", { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) }) });
beforeEach(() => { vi.clearAllMocks(); mock.user = "u1"; mock.denyOrigin = false; mock.list.mockResolvedValue([]); mock.edit.mockResolvedValue(true); mock.remove.mockResolvedValue(1); mock.switches.mockResolvedValue(true); });
describe("memory API authorization and real controls", () => {
  it.each(["GET", "PATCH", "DELETE"])("rejects signed-out %s", async (method) => { mock.user = null; expect((await call(method, method === "GET" ? undefined : {})).status).toBe(401); expect(mock.list).not.toHaveBeenCalled(); expect(mock.edit).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled(); });
  it.each(["PATCH", "DELETE"])("rejects cross-origin %s before mutation", async (method) => { mock.denyOrigin = true; expect((await call(method, {})).status).toBe(403); expect(mock.edit).not.toHaveBeenCalled(); expect(mock.remove).not.toHaveBeenCalled(); });
  it("ignores spoofed owner on edits", async () => { expect((await call("PATCH", { userId: "victim", id: "a", content: "My editor is Vim" })).status).toBe(200); expect(mock.edit).toHaveBeenCalledWith("u1", "a", "My editor is Vim"); });
  it("scopes deletions and clear to the authenticated owner", async () => { await call("DELETE", { all: true, userId: "victim" }); expect(mock.remove).toHaveBeenCalledWith("u1", "all"); });
  it("patches only validated boolean memory switches", async () => { expect((await call("PATCH", { switches: { savedMemories: false, tone: "hostile" }, userId: "victim" })).status).toBe(200); expect(mock.switches).toHaveBeenCalledWith("u1", { savedMemories: false }); expect((await call("PATCH", { switches: { savedMemories: "false" } })).status).toBe(400); });
  it("failed save reflects failure rather than success", async () => { mock.edit.mockResolvedValue(false); expect((await call("PATCH", { id: "a", content: "My editor is Vim" })).status).toBe(400); });
  it("failed reads are not presented as an empty memory list", async () => { mock.list.mockResolvedValue(null); expect((await call("GET")).status).toBe(503); });
});