// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { resolveReference,artifactMatchesSource,extractSource } from "@/lib/ai/references";
import { conversationArtifacts,selectTask,taskCommand } from "@/lib/ai/intelligence";
const state=vi.hoisted(() => ({ db:null as DatabaseSync|null }));
vi.mock("@/lib/cloud/d1.server",() => ({ d1:async (sql:string,p:unknown[]=[]) => {
  if (!state.db) throw new Error("Database missing");
  return state.db.prepare(sql).all(...p as (string|number|null)[]);
} }));
vi.mock("@/lib/jobs/llm.server",() => ({ PLANNING:[],complete:vi.fn(async()=>({text:JSON.stringify({steps:[{tool:"create_document",params:{request:"Export original report",format:"pdf",verbatim:true}}]})})) }));
let store:typeof import("@/lib/ai/intelligence-store.server");
const report="# Coral Reef Report\n\nThe survey measured 427 coral colonies across twelve coastal sites. Water quality was stable and restoration requires careful monitoring of temperature, turbidity, and coral recovery throughout the year.";
beforeEach(async () => {
  vi.resetModules();state.db=new DatabaseSync(":memory:");
  state.db.exec("CREATE TABLE chat_sessions(id TEXT PRIMARY KEY,user_id TEXT); CREATE TABLE chat_messages(id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,metadata TEXT DEFAULT '{}',created_at TEXT); INSERT INTO chat_sessions VALUES('c1','u1'),('c2','u2');");
  state.db.exec(readFileSync("db/main-migrations/0002_intelligence_artifacts.sql","utf8"));
  store=await import("@/lib/ai/intelligence-store.server");
});
afterEach(() => state.db?.close());
const message=(id:string,role:string,content:string,n:number,chat="c1") => state.db?.prepare("INSERT INTO chat_messages(id,session_id,role,content,created_at) VALUES(?,?,?,?,?)").run(id,chat,role,content,String(n).padStart(6,"0"));
const history=()=>[{id:"u",role:"user" as const,content:"Generate a coral reef report"},{id:"a",role:"assistant" as const,content:report},...Array.from({length:20},(_,i)=>({id:`x${i}`,role:(i%2 ? "assistant":"user") as "user"|"assistant",content:i%2 ? "The capital is Lima.":"What is Peru's capital?"}))];

describe("integrated artifact continuity",() => {
  it("finds original report after unrelated questions and creates a PDF carrying that report",async () => {
    history().forEach((m,i)=>message(m.id,m.role,m.content,i));
    const prepared=await store.prepareIntelligenceJob("u1","c1","Make a PDF of that report");
    const source=extractSource(prepared.prompt)?.source;
    expect(source).toBe(report);
    const { TOOL_MAP,textOf }=await import("@/lib/tools/registry.server");
    const tool=TOOL_MAP.get("create_document");if(!tool)throw new Error("Missing tool");
    const complete=vi.fn(async()=>{throw new Error("Must not rewrite source");});
    const result=await tool.run({files:[],lastText:source ?? "",verbatim:source,complete,note:async()=>{}},{request:"Export report",format:"pdf",verbatim:true});
    const file=result.files?.[0];if(!file)throw new Error("No PDF");
    const text=await textOf(file);
    expect(text).toContain("427");expect(artifactMatchesSource(text,report).ok).toBe(true);expect(complete).not.toHaveBeenCalled();
  });
  it("preserves original and selects previous version across unrelated turns and reload",async () => {
    await store.recordIntelligenceArtifact("u1","c1","v1",report,{request:"Write a report",messageId:"v1"});message("v1","assistant",report,1);
    const revised=report.replace("427","512");message("v2","assistant",revised,3);
    await store.recordIntelligenceArtifact("u1","c1","v2",revised,{request:"Revise that report",parentId:"v1",messageId:"v2"});
    message("u9","user","What is the capital of Peru?",4);message("a9","assistant","Lima.",5);
    vi.resetModules();store=await import("@/lib/ai/intelligence-store.server");
    const r=await store.resolveOwnedContext("u1","c1","Export the previous version of that report as PDF");
    expect(r.ref.kind === "found" && r.ref.content).toBe(report);
    const rows=await store.intelligenceArtifacts("u1","c1");expect(rows.map(x=>x.version)).toEqual([1,2]);expect(rows[1].parentId).toBe("v1");
  });
  it("clarifies two plausible report subjects instead of exporting the last",()=>{
    const h=[...history(),{id:"u3",role:"user" as const,content:"Generate a volcano report"},{id:"a3",role:"assistant" as const,content:"# Volcano Report\n\nA detailed volcano survey covers seismic changes, evacuation planning and observed lava flows across the study area."}];
    expect(resolveReference("Make a PDF of that report",h).kind).toBe("ambiguous");
    const r=resolveReference("Make a PDF of that coral reef report",h);expect(r.kind === "found" && r.id).toBe("a");
  });
  it("version lineage links the referenced older subject, not the most recent unrelated artifact",()=>{
    const h=[...history(),{id:"uv",role:"user" as const,content:"Write a volcano report"},{id:"av",role:"assistant" as const,content:"# Volcano Report\n\nA long volcano report covering detailed geological results and eruption monitoring."},{id:"ur",role:"user" as const,content:"Revise that coral reef report"},{id:"ar",role:"assistant" as const,content:report.replace("427","512")}];
    expect(conversationArtifacts(h).at(-1)?.parentId).toBe("a");
  });
  it("isolates another owner's chats, source records and writes",async()=>{
    await expect(store.prepareIntelligenceJob("u2","c1","Export that report")).rejects.toThrow("Conversation not found");
    await expect(store.recordIntelligenceArtifact("u2","c1","other",report,{request:"report"})).rejects.toThrow("Conversation not found");
    expect(await store.intelligenceArtifacts("u2","c1")).toEqual([]);
  });
  it("deduplicates retried writes without overwriting the immutable original",async()=>{
    await store.recordIntelligenceArtifact("u1","c1","v1",report,{request:"report"});
    await store.recordIntelligenceArtifact("u1","c1","v1","changed",{request:"report"});
    const rows=await store.intelligenceArtifacts("u1","c1");expect(rows).toHaveLength(1);expect(rows[0].content).toBe(report);
  });
  it("does not retrieve deleted reply snapshots",async()=>{
    message("v1","assistant",report,1);await store.recordIntelligenceArtifact("u1","c1","v1",report,{request:"report",messageId:"v1"});
    state.db?.exec("UPDATE chat_messages SET metadata='{\"deleted\":true}' WHERE id='v1'");
    expect(await store.intelligenceArtifacts("u1","c1")).toEqual([]);
  });
  it("rejects a wrong output source rather than accepting a phrase-only file",()=>expect(artifactMatchesSource("Export that report into PDF",report).ok).toBe(false));
  it("actual agent execution verifies the original PDF before saving and checkpoint completion",async()=>{
    history().forEach((m,i)=>message(m.id,m.role,m.content,i));
    const prepared=await store.prepareIntelligenceJob("u1","c1","Make PDF of that report");
    const {runAgent}=await import("@/lib/jobs/agent.server");
    const saved:Uint8Array[]=[];const checkpoints:unknown[]=[];let result:any;
    const job={id:"job",userId:"u1",step:async()=>{},note:async()=>{},warn:()=>{},markCurrent:()=>{},finish:async(r:unknown)=>{result=r;}};
    await runAgent(job as any,{prompt:prepared.prompt,files:[]},async(f)=>{saved.push(f.bytes);return{id:"pdf-id"};},{persist:async(cp)=>{checkpoints.push(JSON.parse(JSON.stringify(cp)));}});
    const {textOf}=await import("@/lib/tools/registry.server");
    expect(saved).toHaveLength(1);expect(await textOf({name:"report.pdf",mime:"application/pdf",bytes:saved[0]})).toContain("427");
    expect(result.steps[0].artifacts[0].id).toBe("pdf-id");expect((checkpoints.at(-1) as any).done[0].artifactIds).toEqual(["pdf-id"]);
  });
  it("tool selection does not silently pick a wrong attached file",async()=>{
    const {TOOL_MAP}=await import("@/lib/tools/registry.server");const tool=TOOL_MAP.get("extract_text");if(!tool)throw new Error("Missing extract tool");
    const ctx={files:[{name:"coral.txt",mime:"text/plain",bytes:new TextEncoder().encode(report)},{name:"volcano.txt",mime:"text/plain",bytes:new TextEncoder().encode("Volcano report")}],lastText:"",complete:async()=>"",note:async()=>{}};
    await expect(tool.run(ctx,{})).rejects.toThrow("Which file");
    await expect(tool.run(ctx,{file:"missing.txt"})).rejects.toThrow("not available");
  });
  it("migration is additive and idempotent",()=>{
    state.db?.exec(readFileSync("db/main-migrations/0002_intelligence_artifacts.sql","utf8"));
    expect(state.db?.prepare("SELECT count(*) n FROM chat_sessions").get()?.n).toBe(2);
  });
});
describe("task continuity selection",()=>{
  const tasks=[{id:"coral",prompt:"Research coral reef then create PDF",status:"cancelled"},{id:"lava",prompt:"Research volcano then spreadsheet",status:"failed"}];
  it("resumes the named interrupted task after unrelated topics",()=>expect(selectTask("Resume the coral task",tasks,"resume")).toEqual(tasks[0]));
  it("clarifies competing interrupted tasks",()=>expect(selectTask("Resume that task",tasks,"resume")).toBe("ambiguous"));
  it("does not resume completed or superseded work",()=>expect(selectTask("Resume coral task",[{...tasks[0],status:"completed"},{...tasks[0],resumedBy:"new"}],"resume")).toBeNull());
  it("recognizes commands but not quoted task instructions",()=>{expect(taskCommand("Please pause the coral task")).toBe("pause");expect(taskCommand('Write a scene saying "resume that task"')).toBeNull();});
});