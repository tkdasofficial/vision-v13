// Task Router: classifies each request independently. Pure and browser-safe so it is unit-tested.
import type { ChatMode, OutputKind } from "./modes";

export type TaskNeed = "reasoning" | "research" | "code" | "files" | "data" | "tools";

/** Capability needs scored from several signals (not a single keyword); informational, never changes the mode. */
export function taskNeeds(text: string, hasMedia: boolean, mode: ChatMode): TaskNeed[] {
  const n = new Set<TaskNeed>();
  if (mode === "deep" || DEEP_ACTION.test(text)) n.add("reasoning");
  if (mode === "research" || RESEARCH_ACTION.test(text) || /\b(latest|today|current|news|20\d\d)\b/i.test(text)) n.add("research");
  if (mode === "coding" || CODE_ACTION.test(text) || HAS_CODE.test(text)) n.add("code");
  if (hasMedia || /\b(pdf|docx|xlsx|csv|zip|upload(ed)?|attach(ed|ment)?|file)\b/i.test(text)) n.add("files");
  if (/\b(table|chart|average|sum|percent|statistics?|dataset|spreadsheet)\b/i.test(text) || /^\s*\|.*\|\s*$/m.test(text)) n.add("data");
  if (/\b(convert|compress|qr ?code|barcode|resize|merge|export)\b/i.test(text)) n.add("tools");
  return [...n];
}

export type TaskClassification = {
  needs: TaskNeed[];
  executionMode: ChatMode;
  taskType: "chat" | "light" | "reasoning" | "research" | "code";
  requiresWebSearch: boolean;
  requiresMultimodalProcessing: boolean;
  requiresCodeOutput: boolean;
  requiresResearchDocument: boolean;
  output: OutputKind;
};

const GREETING = /^\s*(hi|hello|hey|yo|thanks|thank you|ok|okay|good (morning|evening|night))\b[\s!.?]*$/i;
// Asking ABOUT something ("what is…", "explain…") is a question, not a request to produce it.
const QUESTION_ABOUT = /^\s*(what|why|how does|who|when|is|are|does|can you explain|explain|define|tell me about)\b/i;
const CODE_ACTION = /\b(write|create|build|make|generate|implement|refactor|fix|debug|convert|add)\b[\s\S]{0,60}\b(code|function|script|component|class|page|program|api|endpoint|query|regex|html|css|javascript|typescript|python|react|sql|app|bug)\b/i;
const HAS_CODE = /```|^\s*(import|export|def|class|function|const|let|SELECT)\b/m;
const RESEARCH_ACTION = /\b(research|investigate|survey|literature review|market analysis|report on|write a report|prepare a report|latest developments)\b/i;
const DEEP_ACTION = /\b(in depth|in-depth|step[- ]by[- ]step|prove|derive|analy[sz]e|thoroughly|rigorous|difficult|complex|trade-?offs?)\b/i;

// Short follow-ups ("make it shorter", "add tests", "continue") refer to the previous request, so they inherit its intent.
const FOLLOW_UP = /^\s*(now|also|and|then|again|continue|go on|more|shorter|longer|simpler|redo|retry|same|instead|but|ok(ay)?,?|make it|change it|fix it|update it|add|remove|rewrite|translate|expand|summari[sz]e)\b/i;

export function classifyTask(input: { text: string; mode: ChatMode; hasMedia: boolean; previousText?: string }): TaskClassification {
  const own = input.text.trim();
  const followUp = !!input.previousText && own.length < 160 && FOLLOW_UP.test(own) && !GREETING.test(own);
  const text = followUp ? `${input.previousText!.trim().slice(0, 4000)}\n${own}` : own;
  const isQuestionAbout = QUESTION_ABOUT.test(text) && !/\b(write|build|create|generate|prepare)\b/i.test(text);
  const wantsCode = CODE_ACTION.test(text) && !isQuestionAbout;
  const pastedCode = HAS_CODE.test(text);
  const wantsReport = RESEARCH_ACTION.test(text) && !isQuestionAbout;
  const wantsStory = /\b(?:write|create|generate|make)\b/i.test(text) && /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty)\s+(?:[a-z-]+\s+){0,2}(?:scenes?|chapters?|shots?|panels?|episodes?|beats?)\b/i.test(text);
  const wantsDeep = wantsStory || DEEP_ACTION.test(text) || text.length > 1200;

  let mode: ChatMode = input.mode;
  if (mode === "default") {
    if (GREETING.test(text) || input.hasMedia) mode = "default";
    else if (wantsReport) mode = "research";
    else if (wantsCode || (pastedCode && /\b(fix|error|bug|why|wrong|review)\b/i.test(text))) mode = "coding";
    else if (wantsDeep) mode = "deep";
  }

  const light = mode === "default" && (GREETING.test(own) || text.length < 80);
  return {
    needs: taskNeeds(text, input.hasMedia, mode),
    executionMode: mode,
    taskType: mode === "research" ? "research" : mode === "coding" ? "code" : mode === "deep" ? "reasoning" : light ? "light" : "chat",
    // Live search is a research need; whether it is actually available is decided by the server.
    requiresWebSearch: mode === "research",
    requiresMultimodalProcessing: input.hasMedia,
    requiresCodeOutput: mode === "coding",
    requiresResearchDocument: mode === "research",
    output: mode === "research" ? "document" : mode === "coding" ? "code" : "chat",
  };
}
