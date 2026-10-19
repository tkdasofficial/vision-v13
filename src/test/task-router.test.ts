import { describe, it, expect } from "vitest";
import { classifyTask } from "@/lib/ai/task-router";
import { normalizeMode, CHAT_MODES } from "@/lib/ai/modes";
import { filenameFor, sanitizeFilename } from "@/lib/code-files";

const run = (text: string, mode: any = "default", hasMedia = false) => classifyTask({ text, mode, hasMedia });

describe("modes", () => {
  it("has exactly four modes", () => expect(CHAT_MODES.map((m) => m.id)).toEqual(["default", "deep", "research", "coding"]));
  it("migrates old ids", () => {
    expect(normalizeMode("general")).toBe("default");
    expect(normalizeMode("reasoning")).toBe("deep");
    expect(normalizeMode("developer")).toBe("coding");
    expect(normalizeMode("designer")).toBe("default");
  });
});

describe("task router (default mode)", () => {
  it("routes numbered continuous stories through checked generation without changing explicit modes", () => {
    expect(run("Write 50 scenes about a courier").executionMode).toBe("deep");
    expect(run("Write 25 chapters about a courier", "coding").executionMode).toBe("coding");
    expect(run("What are story scenes?").executionMode).toBe("default");
  });
  it("greetings stay default", () => expect(run("Hi").executionMode).toBe("default"));
  it("deep analysis", () => expect(run("Analyze this difficult problem in depth.").executionMode).toBe("deep"));
  it("research report", () => {
    const r = run("Research the latest developments in battery tech and prepare a report");
    expect(r.executionMode).toBe("research");
    expect(r.output).toBe("document");
  });
  it("code generation", () => expect(run("Write an HTML page with CSS and JavaScript.").output).toBe("code"));
  it("asking about research is not research", () => expect(run("What is Research Mode?").executionMode).toBe("default"));
  it("conceptual JS question is not coding", () => expect(run("What is JavaScript used for?").executionMode).toBe("default"));
  it("classifies each request independently", () => {
    expect(run("Research this topic and prepare a report.").executionMode).toBe("research");
    expect(run("Now write an HTML page.").executionMode).toBe("coding");
  });
});

describe("manual modes are honored", () => {
  it("keeps selection", () => {
    expect(run("Hi", "research").executionMode).toBe("research");
    expect(run("Hi", "deep").output).toBe("chat");
    expect(run("Hi", "coding").executionMode).toBe("coding");
  });
});

describe("code filenames", () => {
  it("maps extensions", () => {
    expect(filenameFor("html")).toBe("code.html");
    expect(filenameFor("python")).toBe("code.py");
    expect(filenameFor("weird")).toBe("code.txt");
    expect(filenameFor("ts", "../../etc/app.ts")).toBe("app.ts");
    expect(sanitizeFilename("a b?.js")).toBe("a_b_.js");
  });
});
