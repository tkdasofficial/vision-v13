// Content-intent layer: decides whether a request asks for a reusable deliverable (copy-ready),
// machine-readable data/code, or a normal answer. Pure, deterministic, no extra model call.
// Scored from several signals (action + artifact + audience/use, minus "asking about"), not single keywords.

export type ContentIntent = "deliverable" | "code" | "data" | "general";
export type IntentResult = { intent: ContentIntent; category?: string; dataFormat?: string; rawMarkdown: boolean; single?: boolean };

const CREATE = /\b(write|draft|create|compose|generate|make|give me|prepare|craft|come up with|produce|design|build|need|want|suggest|send me|i need|can you (?:write|draft|make|create))\b/i;
const TRANSFORM = /\b(translate|rewrite|rephrase|paraphrase|proofread|correct (?:the )?grammar|fix (?:the )?grammar|polish|shorten|expand|summari[sz]e (?:this|it) (?:for|into|as)|make (?:it|this) (?:more )?(?:formal|professional|casual|polite|shorter|longer|friendly)|tone)\b/i;
const ABOUT = /^\s*(what|why|how (?:does|do|is|are|can|to)|who|when|where|which|is|are|does|do|should|explain|define|describe how|tell me (?:about|why|how)|compare|difference between|analy[sz]e|review|evaluate|what's|whats)\b/i;
const EXPLAIN = /\b(explain|what does .* mean|why (?:is|does|did)|how does|difference between|compare|comparison|pros and cons|analy[sz]e|analysis of|evaluate)\b/i;

const CATEGORIES: [string, RegExp][] = [
  ["prompt", /\b(prompts?|system (?:prompt|instructions?)|ai instructions?|agent instructions?|image[- ]to[- ]video|midjourney|stable diffusion|dall-?e|sora|veo|runway)\b/i],
  ["story", /\b(story|stories|fiction|fairy ?tale|fable|narrative|screenplay|scene[- ]by[- ]scene|character descriptions?|dialogues?|plot outline)\b/i],
  ["social", /\b(caption|instagram|facebook post|linkedin post|tweet|thread|youtube (?:title|description)|shorts|reels?|hashtags?|social media|comment reply|bio for)\b/i],
  ["script", /\b(script|voice[- ]?over|narration|podcast|ad copy|commercial|explainer|subtitles?)\b/i],
  ["message", /\b(message|whatsapp|dm|direct message|text to|reply to|greeting|invitation|invite|thank[- ]you note|apology|announcement|wish(?:es)?)\b/i],
  ["email", /\b(e-?mail|letter|cover letter|application letter|complaint|follow[- ]up|correspondence|leave application)\b/i],
  ["document", /\b(report|proposal|brief|business plan|sop|standard operating procedure|requirements doc(?:ument)?|spec(?:ification)?|meeting notes|statement|documentation|readme|policy|terms)\b/i],
  ["creative", /\b(poem|poetry|shayari|haiku|lyrics|song|slogan|tagline|motto|bio(?:graphy)?|introduction|intro|about me|channel description|portfolio description)\b/i],
  ["marketing", /\b(advert|ad\b|ads\b|sales copy|landing[- ]page copy|product description|promo(?:tional)?|marketing|call to action|cta|campaign)\b/i],
  ["education", /\b(essay|assignment|speech|study notes|answer for (?:my )?exam|presentation script|paragraph on|article)\b/i],
  ["seo", /\b(seo|meta description|meta title|keywords? list|blog post|article outline|headings for)\b/i],
  ["business", /\b(product listing|service listing|business profile|faqs?|store policy|refund policy|listing)\b/i],
  ["plan", /\b(checklist|action plan|roadmap|step[- ]by[- ]step (?:guide|procedure|plan)|workflow|testing plan|task breakdown|itinerary|schedule)\b/i],
  ["template", /\b(template|fill[- ]in[- ]the[- ]blank|form|questionnaire|survey questions)\b/i],
];

const DATA = /\b(json|jsonl|ndjson|xml|yaml|yml|toml|csv|tsv)\b/i;
const CODE = /\b(code|function|component|script in|class|program|snippet|regex|regexp|regular expression|sql query|query|shell command|bash|curl|api request|config(?:uration)? file|schema|html|css|javascript|typescript|react|python|java|golang|rust|php|ruby|swift|kotlin|dockerfile|tsx|jsx)\b/i;

export function detectContentIntent(text: string, previousText?: string): IntentResult {
  const own = text.trim();
  const rawMarkdown = /\b(raw|source|plain)\s+markdown\b|\bmarkdown (?:source|syntax|code)\b/i.test(own);
  // Short edit follow-ups ("make it shorter", "add a CTA") inherit the earlier deliverable.
  const followUp = !!previousText && own.length < 160 && /^\s*(make it|now|also|shorter|longer|more|less|change|add|remove|rewrite|again|another|redo|translate it|in (?:hindi|english|bengali|spanish|french))\b/i.test(own);
  if (followUp) {
    return { ...detectContentIntent(previousText!), rawMarkdown };
  }
  const asking = ABOUT.test(own) && !CREATE.test(own.split(/[.?!]/)[0]);
  const create = CREATE.test(own) || /^\s*(an?|the|\d+|two|three|five|ten)?\s*\w*\s*(prompt|caption|email|story|poem|message|letter|bio|essay|tagline|slogan)s?\b/i.test(own);
  const transform = TRANSFORM.test(own);

  const dataFormat = own.match(DATA)?.[1]?.toLowerCase();
  if (dataFormat && (create || transform || /\b(as|in|into|to)\s+(valid\s+)?(json|jsonl|xml|yaml|yml|toml|csv|tsv)\b/i.test(own)) && !asking) {
    return { intent: "data", dataFormat: dataFormat === "yml" ? "yaml" : dataFormat, rawMarkdown };
  }
  const category = CATEGORIES.find(([, re]) => new RegExp(re.source.replace(/\)\\b$/, ")s?\\b"), "i").test(own))?.[0];
  if (CODE.test(own) && (create || transform) && !asking && category !== "prompt" && !/\b(story|email|caption|letter)\b/i.test(own)) {
    return { intent: "code", rawMarkdown };
  }
  if (asking && !create && !transform) return { intent: "general", rawMarkdown };
  if (transform && !EXPLAIN.test(own)) return { intent: "deliverable", category: category ?? "rewrite", rawMarkdown, single: isSingle(own) };
  if (create && category) return { intent: "deliverable", category, rawMarkdown, single: category === "story" || category === "prompt" ? false : isSingle(own) };
  return { intent: "general", rawMarkdown };
}

const MANY = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|several|multiple|a few|some|couple of)\s+(?:\w+[\s-]+){0,3}?(prompts|emails|captions|stories|messages|versions|options|variations|letters|scripts|posts|poems|slogans|taglines|bios|titles|tweets|replies|ideas|examples)\b|\bexplain\b|\bwhy\b|\bhow (?:to|does|do)\b|\b(?:and|also|plus) (?:tell|describe|list)\b/i;
/** One deliverable with nothing else requested: the server can wrap the whole reply in a single copy box. */
function isSingle(text: string) { return !MANY.test(text); }

/** System-prompt addendum for the detected intent (appended to the existing mode prompt). */
export function intentAddendum(r: IntentResult): string {
  if (r.intent === "deliverable" && (r.category === "story" || r.category === "prompt")) {
    return `\n\nStory/prompt deliverable: output only the requested content, with no blueprint or planning details. A story title is simple text outside the boxes; full story prose has its own ${r.rawMarkdown ? "text" : "markdown"} fence only when requested as a deliverable. Explicit "give me both visual prompt & dialogue" means exactly those two components per scene, even if the task begins "create a story". Character lists and clothing/background constraints are inputs, not requested profiles or extra sections. Each requested scene component gets its own structured fence by default. If the user asks for all details in each scene's prompt box, group those sections into one fence per scene instead. Explicit content and format instructions win. Count dialogue ranges using spoken words per scene, excluding speaker labels and delivery notes. Never repeat the content outside its box. Do not offer a file unless requested.`;
  }
  if (r.intent === "deliverable" && r.single) {
    return `\n\nCopy-ready deliverable: the user wants one piece of reusable ${r.category} content to copy, send, publish or paste elsewhere. Reply with ONLY the finished deliverable itself — no introduction, no closing remarks, no notes, no alternatives, and no code fences around it: the app places your whole reply in a copy box. ${r.rawMarkdown ? "Write it as literal Markdown source." : "Use Markdown structure only where it suits the content (title, headings, lists, emphasis); don't force headings."} For translations or rewrites output only the new version, not the original. Respect every stated constraint (language, word/line/scene counts, names, tone, required headings) and count before replying.`;
  }
  if (r.intent === "deliverable") {
    return `\n\nCopy-ready deliverable: the user wants reusable ${r.category} content they will copy, send, publish or paste elsewhere. Put the complete finished deliverable inside ONE fenced block tagged ${r.rawMarkdown ? "text (the user asked for raw Markdown source, so keep the Markdown syntax literal)" : "markdown"} — one block per separate deliverable they asked for (for example two emails → two blocks). Use Markdown structure inside only where it suits the content (headings, lists, emphasis, tables); don't force headings. That block is the only copy: never repeat, quote or summarise the deliverable in plain text before or after it, never add alternative versions unless asked, and keep any surrounding text to at most one short line. For translations or rewrites, output only the new version, not the original. Respect every stated constraint (language, word/line/scene counts, names, tone, required headings) and only claim a constraint was checked if you actually counted.`;
  }
  if (r.intent === "data") {
    return `\n\nStructured data: return the requested ${r.dataFormat?.toUpperCase()} in a single fenced block tagged ${r.dataFormat}, syntactically valid and complete, with no comments or prose inside it. Preserve headers, delimiters and row structure. Any note goes outside the block in one short line.`;
  }
  if (r.intent === "code") {
    return `\n\nCode deliverable: put each file or snippet in its own fenced block with the correct language tag (typescript, javascript, python, html, css, sql, json, yaml, bash…), exact indentation, and complete files when a full file is requested. Keep explanations brief and outside the fences; don't repeat the code.`;
  }
  return `\n\nThis is a question or discussion, not a reusable deliverable: answer normally in Markdown without copy boxes or fenced prose. Use a table only when comparing.`;
}
