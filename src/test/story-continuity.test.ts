// Regressions from the five 25-scene live attempts (planning, object state, Hindi dialogue, part recovery).
import { describe, it, expect } from "vitest";
import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { checkInstructions, parseInstructions } from "@/lib/ai/deep/instructions";
import { checkObjectStates, checkPlot } from "@/lib/ai/deep/plot";
import { shouldDecompose } from "@/lib/ai/deep/engine";
import { runDeepPipeline, parseOutline, REVIEW_SYSTEM, type CallResult, type ChatMsg } from "@/lib/ai/deep/pipeline";

const ok = (text: string): CallResult => ({ ok: true, text, finishReason: "stop" });
const REQ = "Generate a complete 10-scene image-to-video story about Bolt recovering a stolen energy core. Every scene must contain a title, duration, visual prompt, camera direction and Hindi dialogue where appropriate. Keep Bolt's appearance consistent.";
const sc = (n: number, body: string) => ({ num: n, body });
const plain = (n: number) => sc(n, "Bolt walks through the silent corridor, scanning the walls.");
const scenes = (over: Record<number, string>, n = 10) => Array.from({ length: n }, (_, i) => (over[i + 1] ? sc(i + 1, over[i + 1]) : plain(i + 1)));
const sceneText = (n: number) => `Scene ${n}: Signal ${n}\nDuration: 6s\nVisual Prompt: Bolt, the silver robot with a blue visor, moves through the facility under a "STORM ALERT" sign. Camera: slow dolly-in.\nHindi Dialogue: बोल्ट: "हमें जल्दी करनी होगी।"`;
const outline = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. Bolt event ${i + 1}; core held by the thief in the vault.`).join("\n");

function model(o: { plan?: () => CallResult; fail?: RegExp } = {}) {
  const log: string[] = []; const failedOnce = new Set<string>();
  const call = async (msgs: ChatMsg[]): Promise<CallResult> => {
    const sys = String(msgs[0].content), last = String(msgs.at(-1)!.content);
    if (sys === REVIEW_SYSTEM) { log.push("review"); return ok("PASS"); }
    if (/numbered outline/.test(sys)) { log.push("plan"); return o.plan ? o.plan() : ok(outline(10)); }
    const b = /Write ONLY Scene (\d+) to Scene (\d+)/.exec(last);
    if (b) {
      log.push(`part ${b[1]}-${b[2]}`);
      if (o.fail?.test(last) && !failedOnce.has(b[0])) { failedOnce.add(b[0]); return { ok: false, status: 504, reason: "timeout" }; }
      const nums = Array.from({ length: Number(b[2]) - Number(b[1]) + 1 }, (_, k) => Number(b[1]) + k);
      return ok(nums.map(sceneText).join("\n\n"));
    }
    log.push("other"); return ok(Array.from({ length: 10 }, (_, i) => sceneText(i + 1)).join("\n\n"));
  };
  return { call, log };
}

describe("story request routing", () => {
  it("reads '10-scene' as 10 scenes and routes it through the planned story pipeline", () => {
    const a = analyzeRequest(REQ);
    expect(a.items).toEqual({ count: 10, noun: "scene" });
    expect(shouldDecompose(a)).toBe(false);
  });
});

describe("1. planning is required for multi-scene stories", () => {
  it("never writes an unplanned story when planning keeps returning nothing", async () => {
    const m = model({ plan: () => ({ ok: true, text: "", finishReason: "length" }) });
    const r = await runDeepPipeline({ messages: [{ role: "system", content: "s" }], analysis: analyzeRequest(REQ), call: m.call, plan: true, request: REQ });
    expect(r.ok).toBe(false);
    expect(r.stages).toContain("plan-failed");
    expect(m.log.filter((x) => x.startsWith("part"))).toEqual([]);
    expect(m.log.filter((x) => x === "plan")).toHaveLength(3);
  });
  it("rejects an incomplete outline and retries until it covers every scene", async () => {
    let n = 0;
    const m = model({ plan: () => ok(++n === 1 ? outline(6) : outline(10)) });
    const r = await runDeepPipeline({ messages: [{ role: "system", content: "s" }], analysis: analyzeRequest(REQ), call: m.call, plan: true, request: REQ });
    expect(r.stages).toEqual(expect.arrayContaining(["plan-retry", "plan-validated", "plot-check"]));
    expect(parseOutline(outline(6), 10).missing).toEqual([7, 8, 9, 10]);
  });
  it("gives every part its own outline lines from the same plan", async () => {
    const sent: string[] = []; const m = model();
    const call = async (msgs: ChatMsg[]) => { sent.push(String(msgs.at(-1)!.content)); return m.call(msgs); };
    await runDeepPipeline({ messages: [{ role: "system", content: "s" }], analysis: analyzeRequest(REQ), call, plan: true, request: REQ });
    expect(sent.find((s) => /Write ONLY Scene 6 to Scene 10/.test(s))).toMatch(/5\. Bolt event 5[\s\S]*10\. Bolt event 10/);
  });
});

describe("2. object-state continuity", () => {
  it("checks continuity even for a two-scene story", () => {
    const issues = checkPlot("Scene 1: Bolt destroys the crystal.\n\nScene 2: Bolt holds the crystal in his hand.", "scene");
    expect(issues.some((i) => i.code === "plot_object_reuse" && i.items?.includes(2))).toBe(true);
  });
  it("flags the core retrieved twice with nothing losing it in between (attempt 5, scenes 12 and 17)", () => {
    const i = checkObjectStates(scenes({ 3: "Bolt sees the empty stand where the energy core was.", 4: "Bolt grabs the energy core from the thief's bench.", 6: "Bolt holds the energy core close.", 8: "Bolt retrieves the energy core from the conveyor." }));
    expect(i[0]).toMatchObject({ code: "plot_object_state", items: [4, 8] });
  });
  it("accepts a second retrieval when the loss is shown", () => {
    expect(checkObjectStates(scenes({ 4: "Bolt grabs the energy core.", 6: "A blast knocks the energy core from Bolt's grip.", 8: "Bolt retrieves the energy core from the rubble." }))).toEqual([]);
  });
  it("flags a core left behind that reappears in hand with no transition", () => {
    const i = checkObjectStates(scenes({ 2: "Bolt grabs the energy core.", 5: "Bolt drops the energy core and runs.", 9: "Bolt holds the energy core up to the storm." }));
    expect(i[0]).toMatchObject({ items: [5, 9] });
    expect(i[0].message).toMatch(/left behind/);
  });
  it("flags a core locked in the vault while a character holds it (attempt 5, scenes 22-25)", () => {
    const i = checkObjectStates(scenes({ 2: "Bolt grabs the energy core.", 7: "Bolt locks the energy core inside the vault.", 9: "Bolt carries the energy core in his hand toward the exit." }));
    expect(i[0].items).toEqual([7, 9]);
    expect(i[0].message).toMatch(/vault/);
  });
  it("ignores Continuity lines that only restate state", () => {
    expect(checkObjectStates(scenes({ 2: "Bolt grabs the energy core.", 3: "Continuity: Bolt grabbed the energy core in scene 2.\nBolt holds the energy core." , 4: "Bolt holds the energy core." }))).toEqual([]);
  });
});

describe("3. Hindi dialogue validation", () => {
  const ins = parseInstructions("10 scenes. English visual prompts. Hindi dialogue in Devanagari where appropriate.");
  it("English sign text like STORM ALERT in the visual prompt is not a Hindi warning", () => {
    const text = Array.from({ length: 3 }, (_, i) => sceneText(i + 1)).join("\n\n");
    expect(checkInstructions(text, ins, "scene").filter((i) => /script|foreign|dialogue/.test(i.code))).toEqual([]);
  });
  it("names foreign words mixed into Hindi dialogue with evidence", () => {
    const text = [sceneText(1), sceneText(2).replace("हमें जल्दी करनी होगी।", "यहाँ nessuna चीज़ नहीं है, सब कुछ खाली है, बहुत खाली।")].join("\n\n");
    const f = checkInstructions(text, ins, "scene").find((i) => i.code === "foreign_words");
    expect(f?.items).toEqual([2]);
    expect(f?.message).toMatch(/"nessuna"/);
  });
  it("allows English names and technical terms inside Hindi dialogue", () => {
    const text = sceneText(1).replace("हमें जल्दी करनी होगी।", "Bolt, energy core को उठाओ, storm आने वाला है, जल्दी करो दोस्त।");
    expect(checkInstructions(text, ins, "scene").filter((i) => i.code === "foreign_words")).toEqual([]);
  });
});

describe("4. part recovery and completeness", () => {
  it("retries only the failed part and keeps the completed scenes", async () => {
    const m = model({ fail: /Write ONLY Scene 6 to Scene 10/ });
    const r = await runDeepPipeline({ messages: [{ role: "system", content: "s" }], analysis: analyzeRequest(REQ), call: m.call, plan: true, request: REQ });
    expect(m.log.filter((x) => x === "part 1-5")).toHaveLength(1);
    expect(m.log.filter((x) => x === "part 6-10")).toHaveLength(2);
    expect(r.ok && r.stages).toContain("part-retry");
    const nums = r.ok ? [...r.text.matchAll(/^Scene (\d+):/gm)].map((x) => Number(x[1])) : [];
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it("whole-story check runs on the assembled 10 scenes", () => {
    const text = Array.from({ length: 10 }, (_, i) => sceneText(i + 1)).join("\n\n");
    expect(checkPlot(text, "scene")).toEqual([]);
  });
});

describe("5. trustworthy verification (10-scene live attempt 1)", () => {
  it("an empty reviewer reply is a failed review, not a 'no verdict' issue to correct", async () => {
    const m = model(); let reviews = 0;
    const call = async (msgs: ChatMsg[]) => (String(msgs[0].content) === REVIEW_SYSTEM ? (reviews++, ok("")) : m.call(msgs));
    const r = await runDeepPipeline({ messages: [{ role: "system", content: "s" }], analysis: analyzeRequest(REQ), call, plan: true, request: REQ, review: true });
    expect(r.ok && r.text).not.toMatch(/no verdict/);
    expect(r.ok && r.text).toMatch(/review step could not run/);
    expect(r.ok && r.corrections).toBe(0);
    expect(reviews).toBe(2);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
describe("6. false continuity warnings from 10-scene live attempt 2", () => {
  const live = readFileSync(join(__dirname, "fixtures/bolt-10-live2.md"), "utf8");
  it("moving the core from Bolt's belt field into the crate on his back is not a second retrieval", () => {
    expect(checkPlot(live, "scene").filter((i) => i.code === "plot_object_state")).toEqual([]);
  });
  it("'the sentinel robot remains shut down' does not mean Bolt is disabled", () => {
    expect(checkPlot(live, "scene").filter((i) => i.code === "plot_character_state")).toEqual([]);
  });
  it("still flags Bolt himself shutting down and acting next scene", () => {
    const i = checkPlot(["Scene 1: Bolt walks.", "Scene 2: Bolt is hit and powers down.", "Scene 3: Bolt runs to the door."].join("\n\n"), "scene");
    expect(i.find((x) => x.code === "plot_character_state")?.items).toEqual([2, 3]);
  });
});

describe("7. false Hindi warning from 10-scene live attempt 3", () => {
  const live = readFileSync(join(__dirname, "fixtures/bolt-10-live3.md"), "utf8");
  const ins = parseInstructions("10 scenes. English visual prompts. Hindi dialogue in Devanagari where appropriate.");
  it("a 'Dialogue (Hindi):' field keeps HUD text like “Core Secured” out of the dialogue", () => {
    expect(checkInstructions(live, ins, "scene").filter((i) => /script|foreign|dialogue/.test(i.code))).toEqual([]);
  });
  it("still flags English inside that field", () => {
    const bad = live.replace('"कोर सुरक्षित"', '"Core is safe now, let us go"');
    expect(checkInstructions(bad, ins, "scene").find((i) => i.code === "script")?.items).toEqual([4]);
  });
  it("the attempt-3 story passes the whole-story checks", () => expect(checkPlot(live, "scene")).toEqual([]));
});
