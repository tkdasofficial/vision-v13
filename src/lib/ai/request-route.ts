// Decides which workflow a chat message needs. Browser-safe and pure (tested in src/test/request-route.test.ts).
// Vision is a text model: anything that isn't an explicit tool/file/project request becomes a normal written answer.
import type { ChatMode } from "./modes";

export type RequestRoute =
  | { kind: "chat" }
  | { kind: "tool" }
  | { kind: "long_context" }
  | { kind: "project" }
  | { kind: "code_export"; language: string }
  | { kind: "story" }
  | { kind: "file"; format: string };

/** Long pasted briefs are instructions for a written answer, not one-word tool triggers. */
const SHORT = 600;
const CODE_FORMATS = ["js", "ts", "py", "sql", "sh", "bat", "html", "css", "json", "yaml", "toml", "xml"];

export function routeRequest(content: string, mode: ChatMode = "default"): RequestRoute {
  // Explicit business workbook delivery is executable in every mode, not a blueprint.
  if (/\b(?:create|generate|build|deliver|produce|export)\b/i.test(content) && /\b(?:xlsx|excel workbook)\b/i.test(content) && /\bSales_Data\b/i.test(content) && /\bRegional_Analysis\b/i.test(content) && !/\b(?:specification only|blueprint only|explain how|do not create|don't create)\b/i.test(content)) return { kind: "long_context" };
  // Deep Thinking, Research and Coding otherwise answer in chat.
  if (mode !== "default") return { kind: "chat" };
  const short = content.length <= SHORT;
  // A literal workbook delivery request is executable even inside a long brief.
  // Generic long briefs and requests for a specification still remain written answers.
  if (/\b(?:create|generate|build|deliver|produce|export)\b/i.test(content) && /\b(?:xlsx|excel workbook)\b/i.test(content) && !/\b(?:specification only|blueprint only|explain how|do not create|don't create)\b/i.test(content)) {
    if (/\bSales_Data\b/i.test(content) && /\bRegional_Analysis\b/i.test(content)) return { kind: "long_context" };
    if (/\bdeliver\b.{0,50}\bxlsx\b/i.test(content)) return { kind: "tool" };
  }
  // Large dataset/table generation goes through the Long Context Generation pipeline.
  if (/\b\d{3,}\s*(?:distinct\s+|unique\s+|fictional\s+)*(?:records?|rows?|products?|entries|items)\b/i.test(content) && /\b(excel|xlsx|spreadsheet|workbook|catalog|dataset|csv)\b/i.test(content)) return { kind: "long_context" };
  // Hindi document requests use native verbs, not English-only create/make triggers.
  if (short && /(?:बना(?:ओ|एँ|एं|इए|ना)|तैयार\s+कर|सेव\s+कर|बदल(?:ो|ें)|निर्यात)/u.test(content) && /\b(?:pdf|docx|xlsx|csv|epub)\b|पीडीएफ|दस्तावेज़/u.test(content.toLowerCase())) return { kind: "tool" };

  const isTool = short && (
    /\b(qr\s*code|barcode|code ?128|code ?39|ean-?13|ean-?8|upc-?[ae]|sha-?(1|256|384|512)|checksum|hash of|base64|jwt|uuid|generate (a )?password|strong password|unit conver|convert \d|chart|bar graph|line graph|pie chart|diagram|flowchart|mermaid|gantt|word document|\.docx|docx|epub|e-?book|fetch (the )?(page|url|website)|scrape|extract (text|links)|redact|privacy scan|json to csv|csv to json)\b/i.test(content)
    || (/\b(create|make|generate|export|save|convert)\b/i.test(content) && /\b(pdf|docx|epub|excel|xlsx|spreadsheet|csv)\b/i.test(content))
    || (/https?:\/\/\S+/.test(content) && /\b(summari[sz]e|extract|fetch|save|convert)\b/i.test(content)));
  if (isTool) return { kind: "tool" };

  const isProject = short && /\b(build|create|make|generate)\b.{0,40}\b(web\s*app|website|landing\s*page|portfolio|single.page.app|(2d|3d|browser|html5|arcade|puzzle|platformer)?\s*game)\b/i.test(content);
  if (isProject) return { kind: "project" };

  // Files only when the user explicitly asks for a file in a format.
  const fmt = content.match(/\b(?:as|in|to|into)\s+(?:an?\s+)?\.?(txt|pdf|md|html|css|csv|json|xml|js|ts|py|sql|yaml|toml|sh|bat|rtf|xlsx|xls)\s+(?:file|document|format)\b/i)
    || content.match(/\b(?:save|export|download)\b.{0,40}\b(?:as|to|into)\s+(?:an?\s+)?\.?(txt|pdf|md|html|csv|json|xml|xlsx|xls)\b/i)
    || content.match(/\.?(txt|pdf|md|html|css|csv|json|xml|js|ts|py|sql|yaml|toml|sh|bat|rtf|xlsx|xls)\s+file\b/i);
  const excel = short && /\b(create|make|generate|build)\b.{0,30}\b(excel|spreadsheet|workbook)\b/i.test(content);
  if (fmt && short) {
    const f = fmt[1].toLowerCase();
    return CODE_FORMATS.includes(f) ? { kind: "code_export", language: f } : { kind: "file", format: f };
  }
  if (excel) return { kind: "file", format: "xlsx" };
  // Multi-scene story/prompt generation runs on the background runtime (it exceeds the
  // front-end Workers CPU budget): a counted set of scenes/chapters/episodes for a story.
  if (/\b(?:write|create|generate|make)\b/i.test(content) && /\bstory\b/i.test(content) && /\b\d+\s*[- ]?(?:seconds?|secs?|minutes?|mins?)\b/i.test(content) && /\b(?:all|every)\s+(?:the\s+)?scenes?\b/i.test(content) && /\bprompts?\b/i.test(content)) return { kind: "story" };
  if (/\b\d{1,2}\s*(?:detailed\s*|sequential\s*|separate\s*|distinct\s*|,\s*)*\b(?:scene|chapter|episode|part)s?\b/i.test(content)
    && /\b(?:story|scene[- ]generation\s+prompts?|screenplay|narrative)\b/i.test(content)
    && /\b(?:generate|write|create|produce|craft|develop)\b/i.test(content)) return { kind: "story" };
  // A counted series of linked image/video prompts (5, 10, 20 …) runs on the runtime's prompts worker.
  // Unlinked lists ("5 image prompts for a sunset") stay a chat answer.
  if (isPromptSeries(content) && /\b(?:linked|connected|story|scene[- ]prompts|sequen\w*|consistent|continuous|series|storyboard|episode|chapter)\b/i.test(content) && /\b(?:generate|write|create|produce|craft|make|give)\b/i.test(content)) return { kind: "story" };
  return { kind: "chat" };
}

/** True for a counted set of 2+ prompts ("20 scene prompts", "ten linked image prompts"). */
export function isPromptSeries(content: string): boolean {
  const m = /\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|fifty)[\s-]+(?:[\w-]+[\s,]+){0,3}?prompts\b/i.exec(content);
  return !!m && (Number.isNaN(Number(m[1])) || Number(m[1]) >= 2);
}

/** True when the user explicitly asks for sources/citations/references (not "source code"). */
export function asksForSources(text: string): boolean {
  return /\b(cite|citations?|with sources|(?:give|list|include|provide|add|show)\s+(?:me\s+)?(?:the\s+|your\s+)?(?:sources?|references?)(?!\s*code)|sources?\s+please|web\s*search|search\s+(?:the\s+)?(?:web|internet|online)|latest|recent\s+news|news\s+(?:about|on)|updates?\s+(?:about|on))\b/i.test(text);
}
