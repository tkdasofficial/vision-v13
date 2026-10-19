import { describe, it, expect } from "vitest";
import { classifyTask } from "@/lib/ai/task-router";

describe("request intent", () => {
  it("follow-up inherits the previous coding request", () => {
    const t = classifyTask({ text: "make it shorter", mode: "default", hasMedia: false, previousText: "write a python script that renames files" });
    expect(t.executionMode).toBe("coding");
  });
  it("'how do I build a react app' is treated as a coding request", () => {
    expect(classifyTask({ text: "how do I build a react app with a login page", mode: "default", hasMedia: false }).executionMode).toBe("coding");
  });
  it("a new unrelated question does not inherit the old intent", () => {
    expect(classifyTask({ text: "What is the capital of France?", mode: "default", hasMedia: false, previousText: "write a python script" }).executionMode).toBe("default");
  });
});
