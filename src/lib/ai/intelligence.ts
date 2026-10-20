// Shared contextual selection contract. No provider calls, browser storage or authority decisions.
import type { ConvMsg, Resolution } from "./references";

export type ArtifactRecord = {
  id: string; title: string; kind: string; content: string; parentId?: string | null;
  rootId: string; version: number; chatId?: string; messageId?: string; artifactId?: string;
};
export type TaskRecord = { id: string; prompt: string; status: string; resumedBy?: string | null };
const WORDS = /[\p{L}\p{N}]+/gu;
const STOP = new Set("the a an this that it to of for please make create use earlier previous latest original full entire complete report document file pdf version task resume continue pause stop revise rewrite edit export convert into as on about me my your".split(" "));
export const contextTerms = (text: string) => [...new Set((text.toLowerCase().match(WORDS) ?? []).filter((s) => s.length > 2 && !STOP.has(s)))];
/** Bounded subject-based recall outside the recent window, with paired user request and answer. */
export function relevantConversation(text:string,history:ConvMsg[],budget=8000):ConvMsg[] {
  const terms=contextTerms(text);if(!terms.length)return [];
  const ranked=history.map((m,index)=>({m,index,score:terms.filter(t=>typeof m.content === "string" && contextTerms(m.content.slice(0,12000)).includes(t)).length})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||b.index-a.index);
  const picked=new Set<number>();let used=0;
  for(const r of ranked){
    for(const index of r.m.role === "assistant" ? [r.index-1,r.index] : [r.index,r.index+1]){
      const m=history[index];if(!m||picked.has(index)||typeof m.content !== "string")continue;
      if(used+m.content.length>budget)continue;used+=m.content.length;picked.add(index);
    }
    if(picked.size>=6)break;
  }
  return [...picked].sort((a,b)=>a-b).map(i=>history[i]);
}
const KINDS = /\b(report|story|poem|article|essay|script|letter|workbook|spreadsheet|code|document|draft|summary|prompt|dialogue|chart)\b/i;

/** Classify actual deliverables using their initiating request, not arbitrary short replies. */
export function artifactDescriptor(content: string, request = ""): { kind: string; title: string } | null {
  if (!content.trim() || /^(?:Sorry|That didn't work|I couldn't|Task cancelled|Which )/i.test(content)) return null;
  const heading = content.match(/^\s*(?:```markdown\s*)?#{1,3}\s+([^\n]+)/m)?.[1];
  const kind = KINDS.exec(request)?.[1]?.toLowerCase() ?? (content.includes("```") && !content.includes("```markdown") ? "code" : KINDS.exec(heading ?? "")?.[1]?.toLowerCase());
  if (!kind || content.length < 50) return null;
  return { kind, title: (heading ?? request.replace(/\s+/g, " ")).slice(0, 160) || kind };
}

export function conversationArtifacts(history: ConvMsg[]): ArtifactRecord[] {
  const out: ArtifactRecord[] = [];
  let request = "";
  history.forEach((m, index) => {
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") { request = text; return; }
    const desc = artifactDescriptor(text, request);
    if (!desc) return;
    const revision = /\b(revise|rewrite|edit|improve|previous version|update|polish)\b/i.test(request);
    const selected = revision ? selectArtifact(request,out) : { kind:"none" as const };
    const parent = selected.kind === "found" ? out.find((r) => r.id === selected.id || r.messageId === selected.id) : undefined;
    const id = m.id ?? `turn-${index}`;
    out.push({ ...desc, id, messageId: m.id, content: text, rootId: parent?.rootId ?? id, parentId: parent?.id, version: parent ? parent.version + 1 : 1 });
  });
  return out;
}

/** Resolve by subject + kind + version family; equal plausible roots must clarify, not pick by recency. */
export function selectArtifact(request: string, records: ArtifactRecord[]): Resolution {
  const kind = KINDS.exec(request)?.[1]?.toLowerCase();
  const referenced = /\b(that|this|it|earlier|previous|original|latest|last|first|second|version)\b/i.test(request) || /\b(?:of|from)\s+(?:the|my|your)\b/i.test(request);
  if (/\b(response|answer|reply|message)\b/i.test(request) && !kind) return { kind:"none" };
  if (!referenced) return { kind: "none" };
  let pool = records.filter((r) => !kind || kind === "document" || kind === "draft" || r.kind === kind || (kind === "report" && r.title.toLowerCase().includes("report")));
  if (!pool.length) return { kind: "none" };
  const terms = contextTerms(request).filter((s) => !KINDS.test(s));
  const ranked = pool.map((r) => ({ r, score: terms.reduce((n, t) => n + (r.title.toLowerCase().includes(t) ? 4 : contextTerms(r.content.slice(0, 12000)).includes(t) ? 1 : 0), 0) }));
  const top = Math.max(...ranked.map((x) => x.score));
  if (terms.length && top > 0) pool = ranked.filter((x) => x.score === top).map((x) => x.r);
  const roots = [...new Set(pool.map((r) => r.rootId))];
  const ordinal = /\b(first|second|third)\b/i.exec(request)?.[1]?.toLowerCase();
  const explicitLatest = /\b(latest|last|most recent)\b/i.test(request);
  if (roots.length > 1 && !ordinal && !explicitLatest) return { kind: "ambiguous", label: kind ?? "artifact", question: `Which ${kind ?? "output"} do you mean: ${pool.filter((r, i, all) => all.findIndex((x) => x.rootId === r.rootId) === i).slice(0, 4).map((r) => `“${r.title}”`).join(" or ")}?` };
  const root = ordinal ? roots[({ first: 0, second: 1, third: 2 } as Record<string, number>)[ordinal]] : pool.at(-1)?.rootId;
  if (!root) return { kind: "missing", label: "artifact", reason: "That output is not available in this conversation." };
  const family = records.filter((r) => r.rootId === root && (!kind || kind === "document" || kind === "draft" || r.kind === kind)).sort((a, b) => a.version - b.version);
  const requestedVersion = /\bversion\s*(?:#|number)?\s*(\d+)\b/i.exec(request)?.[1];
  const original = /\b(original|first version)\b/i.test(request);
  const previous = /\bprevious version\b/i.test(request);
  const hit = requestedVersion ? family.find((r) => r.version === Number(requestedVersion)) : original ? family[0] : previous ? family.at(-2) : family.at(-1);
  if (!hit) return { kind: "missing", label: "version", reason: "That version has not been saved." };
  return { kind: "found", role: "assistant", ordinal: hit.version, index: records.indexOf(hit), id: hit.messageId ?? hit.id, content: hit.content, label: `${hit.title} (version ${hit.version})` };
}

export function taskCommand(text: string): "pause" | "resume" | null {
  if (text.length > 240 || /["“`]/.test(text)) return null;
  if (/^(?:please\s+)?(?:pause|stop|hold|suspend)\b[\s\S]*\b(task|work|job|steps?|workflow)\b/i.test(text)) return "pause";
  if (/^(?:please\s+)?(?:resume|continue|restart|retry)\b[\s\S]*\b(task|work|job|workflow)\b/i.test(text)) return "resume";
  return null;
}

export function selectTask(text: string, tasks: TaskRecord[], action: "pause" | "resume"): TaskRecord | null | "ambiguous" {
  const terminal = new Set(["completed", "completed_with_warnings", "failed", "cancelled", "timed_out"]);
  let pool = tasks.filter((t) => !t.resumedBy && (action === "pause" ? !terminal.has(t.status) : ["failed", "cancelled", "timed_out"].includes(t.status)));
  const terms = contextTerms(text);
  const scored = pool.map((t) => ({ t, score: terms.filter((s) => t.prompt.toLowerCase().includes(s)).length }));
  const max = Math.max(0, ...scored.map((s) => s.score));
  if (max) pool = scored.filter((s) => s.score === max).map((s) => s.t);
  return pool.length > 1 ? "ambiguous" : pool[0] ?? null;
}