import { describe, it, expect, vi } from "vitest";
import { TOOL_MAP, type WorkFile, type ToolCtx } from "@/lib/tools/registry.server";
import { runAgent } from "@/lib/jobs/agent.server";
import { emptyCheckpoint } from "@/lib/jobs/checkpoint";

vi.mock("@/lib/jobs/llm.server", () => ({ PLANNING: [], complete: vi.fn(async () => ({ text: '{"steps":[{"tool":"create_document","params":{"request":"भारत के बारे में लिखो","format":"txt"}}]}' })) }));
vi.mock("@/lib/tools/registry.server", () => ({
  TOOL_MAP: new Map([["create_document", { id: "create_document", category: "File creation", params: '{"request": string, "format": "txt"}', run: async (ctx: ToolCtx) => {
    await ctx.stage?.("writing_content", "Writing"); await ctx.stage?.("creating_document", "Creating TXT");
    return { files: [{ name: "hindi.txt", mime: "text/plain", bytes: new TextEncoder().encode("भारत") }] };
  } }]]), catalogText: () => "", verifyOutput: async () => null, textOf: async (f: WorkFile) => new TextDecoder().decode(f.bytes),
}));
vi.mock("@/lib/tools/tool-schema", () => ({ executeTool: async (tool: any, ctx: any, params: any) => tool.run(ctx, params) }));
describe("artifact lifecycle", () => {
  it("reads opted-in display contents from the saved file, not tool commentary", async () => {
    const finish = vi.fn();
    const job = { id: "job-test", userId: "u", step: async () => {}, note: async () => {}, markCurrent: () => {}, warn: () => {}, finish };
    await runAgent(job as any, { prompt: "Create TXT and show its content", files: [] }, async () => ({ id: "file-1" }), { resume: { cp: emptyCheckpoint("u", "job-test", { steps: [{ tool: "create_document", params: {} }] }), outputs: [] } });
    expect(finish.mock.calls[0][0].displayText).toBe("भारत");
  });
  it("does not read file contents for file-only delivery", async () => {
    const finish = vi.fn();
    const job = { id: "job-test", userId: "u", step: async () => {}, note: async () => {}, markCurrent: () => {}, warn: () => {}, finish };
    await runAgent(job as any, { prompt: "Create TXT", files: [] }, async () => ({ id: "file-1" }), { resume: { cp: emptyCheckpoint("u", "job-test", { steps: [{ tool: "create_document", params: {} }] }), outputs: [] } });
    expect(finish.mock.calls[0][0].displayText).toBeUndefined();
    expect(finish.mock.calls[0][0].steps[0].artifacts[0].id).toBe("file-1");
  });
  it("reports writing, creation, validation and saving before completion", async () => {
    const events: string[] = [];
    const job = { id: "job-test", userId: "u", step: async (stage: string) => { events.push(stage); }, note: async () => {}, markCurrent: () => {}, warn: () => {}, finish: async () => { events.push("completed"); } };
    const tool = TOOL_MAP.get("create_document");
    if (!tool) throw new Error("missing document tool");
    const spy = vi.spyOn(tool, "run").mockImplementation(async (ctx: ToolCtx) => {
      await ctx.stage?.("writing_content", "Writing");
      await ctx.stage?.("creating_document", "Creating TXT");
      return { files: [{ name: "hindi.txt", mime: "text/plain", bytes: new TextEncoder().encode("भारत") }] };
    });
    let saves = 0;
    await runAgent(job as any, { prompt: "Hindi file", files: [] }, async (_file: WorkFile) => { saves++; events.push("persisted"); return { id: "file-1" }; }, { resume: { cp: emptyCheckpoint("u", "job-test", { steps: [{ tool: "create_document", params: { request: "भारत", format: "txt" } }] }), outputs: [] } });
    expect(events.slice(-6)).toEqual(["writing_content", "creating_document", "validating_output", "saving_file", "persisted", "completed"]);
    expect(saves).toBe(1); spy.mockRestore();
  });
  it("cannot complete when saving the artifact fails", async () => {
    const finish = vi.fn();
    const job = { id: "job-test", userId: "u", step: async () => {}, note: async () => {}, markCurrent: () => {}, warn: () => {}, finish };
    await expect(runAgent(job as any, { prompt: "Hindi file", files: [] }, async () => { throw new Error("storage unavailable"); }, { resume: { cp: emptyCheckpoint("u", "job-test", { steps: [{ tool: "create_document", params: { request: "भारत", format: "txt" } }] }), outputs: [] } })).rejects.toThrow("storage unavailable");
    expect(finish).not.toHaveBeenCalled();
  });
});