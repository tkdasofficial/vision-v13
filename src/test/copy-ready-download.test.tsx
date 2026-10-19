// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownReply from "@/components/chat/markdown-reply";
import { detectContentIntent, intentAddendum } from "@/lib/ai/content-intent";
import { markdownToPlainText, dedupeDeliverables } from "@/lib/markdown-plain";
import { artifactResponse, type ArtifactRecord } from "@/lib/jobs/artifact-download";
import { fetchDownload } from "@/lib/download";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("content intent", () => {
  const i = (t: string, prev?: string) => detectContentIntent(t, prev).intent;
  it.each([
    "Write a short story about a lighthouse keeper in 10 scenes",
    "Create an image prompt for a neon city at night",
    "Draft a professional email asking my manager for leave",
    "Write an Instagram caption for my cafe launch",
    "Translate this message to Hindi: See you tomorrow at 5",
    "Rewrite this paragraph to sound more professional: we done the work",
    "Write a cover letter for a junior designer role",
    "Give me 5 slogans for an eco water bottle",
    "Write a YouTube video script about budgeting",
    "Prepare a project proposal for a school library app",
  ])("deliverable: %s", (t) => expect(i(t)).toBe("deliverable"));
  it.each([
    "Explain how authentication works",
    "What does this error mean? TypeError: x is undefined",
    "Compare PNG and WebP file formats",
    "Analyze the trade-offs between React and Vue",
    "Why is the sky blue?",
  ])("general: %s", (t) => expect(i(t)).toBe("general"));
  it("code and data requests", () => {
    expect(i("Write a TypeScript function that debounces calls")).toBe("code");
    expect(detectContentIntent("Create a JSON configuration for a logger")).toMatchObject({ intent: "data", dataFormat: "json" });
    expect(detectContentIntent("Give me sample sales data as CSV")).toMatchObject({ intent: "data", dataFormat: "csv" });
  });
  it("short follow-up edits inherit the earlier deliverable", () => {
    expect(i("make it shorter", "Write a WhatsApp message inviting friends to dinner")).toBe("deliverable");
    expect(i("make it shorter", "Explain how DNS works")).toBe("general");
  });
  it("raw markdown requests keep syntax literal", () => {
    const r = detectContentIntent("Write a README in raw markdown for my CLI tool");
    expect(r.rawMarkdown).toBe(true);
    expect(intentAddendum(r)).toContain("literal Markdown source");
  });
  it("addenda forbid duplication and preserve data validity", () => {
    expect(intentAddendum(detectContentIntent("Write a poem about rain"))).toMatch(/ONLY the finished deliverable/);
    expect(intentAddendum(detectContentIntent("Write three captions for my bakery"))).toMatch(/never repeat/);
    expect(intentAddendum(detectContentIntent("Create a JSON configuration"))).toMatch(/valid/);
    expect(intentAddendum(detectContentIntent("Explain closures"))).toMatch(/without copy boxes/);
  });
});

describe("plain text and dedupe", () => {
  it("strips markers but keeps structure", () => {
    expect(markdownToPlainText("# Title\n\nHello **bold** and *it* `x`\n\n* a\n* b\n1. one\n\n[site](https://x.io)")).toBe("Title\n\nHello bold and it x\n\n- a\n- b\n1. one\n\nsite (https://x.io)");
  });
  it("keeps code indentation inside nested fences", () => {
    expect(markdownToPlainText("Run:\n```js\nif (a) {\n    b();\n}\n```")).toBe("Run:\nif (a) {\n    b();\n}");
  });
  it("drops a plain-text repeat of the deliverable", () => {
    const story = "Once upon a time a keeper lit the lamp every night for the ships.";
    const md = `Here it is:\n\n${story}\n\n\`\`\`markdown\n${story}\n\`\`\`\n\nEnjoy!`;
    const out = dedupeDeliverables(md);
    expect(out.split(story).length - 1).toBe(1);
    expect(out).toContain("Here it is:");
    expect(out).toContain("Enjoy!");
  });
  it("leaves replies without copy boxes unchanged", () => {
    const md = "Paragraph one is long enough to be considered for dedupe.\n\nParagraph one is long enough to be considered for dedupe.";
    expect(dedupeDeliverables(md)).toBe(md);
  });
});

describe("copy-ready rendering", () => {
  const clip = () => { const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } }); return writeText; };
  it("renders an email once and copies the whole long draft without explanation", async () => {
    const writeText = clip();
    const bodyText = Array.from({ length: 200 }, (_, n) => `Line ${n} of the update.`).join(" ");
    render(<MarkdownReply>{`Here is your email.\n\n\`\`\`markdown\n**Subject:** Update\n\nHi Sam,\n\n${bodyText}\n\nThanks,\nAsha\n\`\`\``}</MarkdownReply>);
    const box = screen.getByRole("region", { name: "Markdown copy box" });
    expect(box).not.toHaveTextContent("**");
    fireEvent.click(within(box).getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.startsWith("Subject: Update\n\nHi Sam,")).toBe(true);
    expect(copied).toContain("Line 199 of the update.");
    expect(copied).not.toContain("Here is your email");
  });
  it("keeps code and JSON in the code viewer and CSV structure intact", () => {
    render(<MarkdownReply>{"```json\n{\"a\": 1}\n```\n\n```csv\nname,qty\nA,-3\n```\n\n```python\ndef f():\n    return 1\n```"}</MarkdownReply>);
    const viewers = Array.from(document.querySelectorAll(".content-block-body"));
    expect(JSON.parse(viewers[0].textContent ?? "")).toEqual({ a: 1 });
    expect(viewers[1].textContent).toBe("name,qty\nA,-3");
    expect(viewers[2].textContent).toBe("def f():\n    return 1");
  });
  it("normal explanations get no copy box", () => {
    render(<MarkdownReply>{"Authentication checks **who** you are.\n\n- Sessions\n- Tokens"}</MarkdownReply>);
    expect(screen.queryByRole("region")).toBeNull();
  });
});

const rec = (o: Partial<ArtifactRecord> = {}): ArtifactRecord => ({ id: "11111111-2222-3333-4444-555555555555", user_id: "u1", name: "report é.pdf", mime: "application/pdf", size: 4, sha256: "", drive_file_id: "d1:x", kind: "output", expires_at: new Date(Date.now() + 60_000).toISOString(), ...o });
const call = (o: Partial<Parameters<typeof artifactResponse>[0]> = {}) => artifactResponse({ userId: "u1", id: rec().id, find: async () => rec(), read: async () => new Uint8Array([37, 80, 68, 70]), ...o });

describe("artifact download endpoint", () => {
  it("owner gets the exact bytes with filename, type and length", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Length")).toBe("4");
    expect(r.headers.get("Content-Disposition")).toContain("filename*=UTF-8''report%20%C3%A9.pdf");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });
  it("verifies the stored checksum", async () => {
    const sha = "e8a9a9d8b4c4b8c4a8c0f3c8e0e7a3c1c9d6e1f1b2a2c3d4e5f6a7b8c9d0e1f2";
    expect((await call({ find: async () => rec({ sha256: sha }) })).status).toBe(500);
  });
  it.each([
    [{ userId: null }, 401, "auth_required"],
    [{ id: "../etc" }, 404, "invalid_id"],
    [{ find: async () => null }, 404, "not_found"],
    [{ userId: "u2" }, 403, "forbidden"],
    [{ find: async () => rec({ expires_at: new Date(Date.now() - 1).toISOString() }) }, 410, "expired"],
    [{ read: async () => { throw new Error("Stored file not found"); } }, 404, "missing_object"],
    [{ read: async () => { throw new Error("Drive 500"); } }, 502, "storage_unavailable"],
    [{ read: async () => new Uint8Array([1]) }, 500, "corrupted"],
  ] as const)("%o → %i", async (o, status, code) => {
    const r = await call(o as any);
    expect(r.status).toBe(status);
    expect((await r.json()).code).toBe(code);
  });
  it("never sends another user's file bytes", async () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
    await call({ userId: "intruder", read });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("browser download", () => {
  it("sends credentials and returns the blob", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "application/zip", "Content-Length": "2" } }));
    const b = await fetchDownload("/api/artifacts/x", f as any);
    expect(b.size).toBe(2);
    expect((f.mock.calls[0] as any)[1]).toMatchObject({ credentials: "include" });
  });
  it("explains server errors instead of saving them as a file", async () => {
    const f = async () => Response.json({ error: "Your session has ended.", code: "auth_required" }, { status: 401 });
    await expect(fetchDownload("/a", f as any)).rejects.toMatchObject({ status: 401, code: "auth_required", message: "Your session has ended." });
  });
  it("rejects an HTML page, a truncated body and a network failure", async () => {
    await expect(fetchDownload("/a", (async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })) as any)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(fetchDownload("/a", (async () => new Response(new Uint8Array([1]), { headers: { "Content-Length": "5" } })) as any)).rejects.toMatchObject({ code: "incomplete" });
    await expect(fetchDownload("/a", (async () => { throw new TypeError("offline"); }) as any)).rejects.toMatchObject({ code: "network" });
  });
});

describe("single deliverable wrapping", () => {
  it("single vs multiple deliverables", () => {
    expect(detectContentIntent("Write a 4-line poem about monsoon rain").single).toBe(true);
    expect(detectContentIntent("Write two prompts for a cat video").single).toBe(false);
    expect(detectContentIntent("Explain prompt engineering and write a prompt for a logo").single).not.toBe(true);
  });
  it("wraps the streamed reply in exactly one copy fence", async () => {
    const { wrapCopyReady } = await import("@/lib/ai/copy-ready-stream");
    const src = new Response('data: {"choices":[{"delta":{"content":"Rain falls."}}]}\n\ndata: [DONE]\n\n').body!;
    const text = await new Response(wrapCopyReady(src)).text();
    const content = [...text.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]).choices[0].delta.content).join("");
    expect(content).toBe("````markdown\nRain falls.\n````\n");
  });
});
