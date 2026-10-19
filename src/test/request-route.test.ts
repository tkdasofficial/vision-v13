import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { routeRequest } from "@/lib/ai/request-route";

const STORY_BRIEF = `Analyze the following story carefully and convert it into a complete, chronologically accurate sequence of image-to-video generation prompts.
STORY
A young girl found a tiny seed beneath an ancient tree. She planted it in the middle of a dry village and watered it every day.
YOUR TASK
- Calculate the total duration before generating the final scene list.
- Generate Image-to-Video Prompts for every scene. Output the scene list in JSON if needed.`.repeat(2);

describe("request routing", () => {
  it("a long pasted story brief gets a written answer", () => {
    expect(routeRequest(STORY_BRIEF, "default").kind).toBe("chat");
  });
  it("Deep Thinking always answers in chat", () => {
    expect(routeRequest("create a qr code for my site", "deep").kind).toBe("chat");
  });
  it("writing a poem or story is a chat answer, not a file", () => {
    expect(routeRequest("write a poem about rain").kind).toBe("chat");
    expect(routeRequest("write a short story about a dragon").kind).toBe("chat");
  });
  it("asking for image prompts is a chat answer", () => {
    expect(routeRequest("create 5 image prompts for a sunset scene").kind).toBe("chat");
  });
  it("explicit tools still run as tools", () => {
    expect(routeRequest("make a qr code for https://example.com").kind).toBe("tool");
    expect(routeRequest("create a pdf of my resume").kind).toBe("tool");
  });
  it("routes the short Hindi PDF request to actual file creation", () => {
    expect(routeRequest("भारत के बारे में एक छोटी हिंदी PDF बनाओ")).toEqual({ kind: "tool" });
    expect(routeRequest("भारत के बारे में एक छोटी हिंदी PDF बनाओ", "deep")).toEqual({ kind: "chat" });
  });
  it("explicit code files are exported", () => {
    expect(routeRequest("save the script as a py file")).toEqual({ kind: "code_export", language: "py" });
  });
  it("building a website is a project", () => {
    expect(routeRequest("build a landing page for my bakery").kind).toBe("project");
  });
  const UPLOAD = "/mnt/user-uploads/Analyze_the_following_story_carefully_and_pasted.md";
  it.skipIf(!existsSync(UPLOAD))("the user's real pasted brief gets a written answer", () => {
    expect(routeRequest(readFileSync(UPLOAD, "utf8"), "default").kind).toBe("chat");
  });
});

describe("story background routing", () => {
  it("routes counted scene-prompt story requests to the background runtime", () => {
    const p = "Generate exactly 10 detailed, sequential scene-generation prompts for a single supernatural horror story set in an abandoned mansion. First, establish a Master Story Blueprint. Each scene must be a separate Markdown document.";
    expect(routeRequest(p, "default")).toEqual({ kind: "story" });
  });
  it("routes counted chapter story requests to the background runtime", () => {
    expect(routeRequest("Write a story with 5 chapters about a haunted lighthouse", "default")).toEqual({ kind: "story" });
  });
  it("keeps ordinary story chat in chat", () => {
    expect(routeRequest("Tell me a short story about a cat", "default")).toEqual({ kind: "chat" });
    expect(routeRequest("Generate exactly 10 detailed, sequential scene-generation prompts for a horror story", "deep")).toEqual({ kind: "chat" });
  });
});

describe("story_generate runtime params", () => {
  it("keeps only the prompt for story_generate", async () => {
    const { cleanParams } = await import("@/lib/runtime/operations");
    expect(cleanParams("story_generate", { prompt: "a story", target: "x", evil: true })).toEqual({ prompt: "a story" });
  });
  it("registers story_generate as a no-input operation", async () => {
    const { RUNTIME_OPS } = await import("@/lib/runtime/operations");
    expect(RUNTIME_OPS.story_generate.maxInput).toBe(0);
  });
});

import { isPromptSeries as _ps } from "@/lib/ai/request-route";
describe("linked prompt series", () => {
  it("detects counted prompt series of 2+", () => {
    expect(_ps("Generate 20 linked scene prompts for a short film")).toBe(true);
    expect(_ps("write ten image prompts")).toBe(true);
    expect(_ps("write 1 prompts")).toBe(false);
    expect(_ps("improve this prompt")).toBe(false);
  });
});
describe("linked prompt routing", () => {
  it("linked series go to the runtime, plain lists stay chat", () => {
    expect(routeRequest("Generate 20 linked scene prompts for a short film").kind).toBe("story");
    expect(routeRequest("create 5 image prompts for a sunset scene").kind).toBe("chat");
  });
});
