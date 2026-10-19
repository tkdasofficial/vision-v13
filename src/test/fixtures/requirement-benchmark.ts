// Requirement-understanding benchmark. Each case lists the reference interpretation as atoms, written by hand
// from the request text alone (never from model output). Atom grammar (see src/lib/ai/requirement-spec.ts):
//   kind:value            explicit, mandatory
//   kind:value?           explicit but optional ("if possible", "preferably")
//   kind:value~           inferred, not stated by the user (must never appear as an explicit atom)
// DEV cases were used while developing; HOLDOUT cases were written up front and never tuned against.
import type { ConvMsg } from "@/lib/ai/references";

export type BenchCase = { id: string; cat: string; text: string; history?: ConvMsg[]; expect: string[]; critical?: string[] };
const A = (content: string): ConvMsg => ({ role: "assistant", content });
const U = (content: string): ConvMsg => ({ role: "user", content });
const LIST_HIST = [U("Give me 3 dinner ideas as a numbered list."), A("1. Pasta primavera\n2. Chicken curry\n3. Veggie tacos")];
const TWO_ANSWERS = [U("What is DNS?"), A("DNS translates names into IP addresses."), U("And HTTP?"), A("HTTP is the protocol browsers use to fetch pages.")];

export const DEV: BenchCase[] = [
  { id: "d01", cat: "simple", text: "What is the capital of France?", expect: [] },
  { id: "d02", cat: "simple", text: "Explain photosynthesis briefly.", expect: ["length:short"] },
  { id: "d03", cat: "simple", text: "Give me a detailed explanation of how TCP handshakes work.", expect: ["length:detailed"] },
  { id: "d04", cat: "simple", text: "Write 5 tips for better sleep.", expect: ["count:5:tip"] },
  { id: "d05", cat: "format", text: "List 10 startup ideas as a numbered list.", expect: ["count:10:idea", "format:numbered"] },
  { id: "d06", cat: "multi", text: "Write 3 product descriptions for a water bottle, each under 50 words, in a friendly tone.", expect: ["count:3:description", "words:-50:item", "tone:friendly"] },
  { id: "d07", cat: "multi", text: "Create a table comparing Python, Java and Go with columns for speed, typing and use cases. No extra commentary.", expect: ["format:table", "no-commentary"] },
  { id: "d08", cat: "business", text: "Write a formal email to my manager asking for leave on Monday. Keep it under 120 words and don't mention my health.", expect: ["deliverable:email", "tone:formal", "words:-120:total", "exclude:my health"] },
  { id: "d09", cat: "multi", text: "Summarize this article in exactly 3 bullet points, no headings.", expect: ["deliverable:summary", "count:3:bullet", "format:bullets", "no-headings"] },
  { id: "d10", cat: "creative", text: "Write a haiku about rain.", expect: ["deliverable:haiku"] },
  { id: "d11", cat: "format", text: "Return only valid JSON with fields name, email and age.", expect: ["format:json", "no-commentary"] },
  { id: "d12", cat: "format", text: "Answer in one sentence.", expect: ["length:short"] },
  { id: "d13", cat: "format", text: "Write between 200 and 300 words about climate change.", expect: ["words:200-300:total"] },
  { id: "d14", cat: "format", text: "Each slide should have no more than 40 words. Make 8 slides about marketing.", expect: ["count:8:slide", "words:-40:item"] },
  { id: "d15", cat: "format", text: "Write a tweet under 280 characters announcing our launch.", expect: ["deliverable:tweet", "chars:280"] },
  { id: "d16", cat: "format", text: "Give me the answer in YAML.", expect: ["format:yaml"] },
  { id: "d17", cat: "technical", text: "Write a Python function that reverses a string.", expect: ["format:code-python"] },
  { id: "d18", cat: "hinglish", text: "Mujhe 5 shayari likh do pyaar par, Hindi mein.", expect: ["count:5:shayari", "lang:hindi"] },
  { id: "d19", cat: "hinglish", text: "ek short paragraph likho about monsoon, english me", expect: ["count:1:paragraph", "length:short", "lang:english"] },
  { id: "d20", cat: "multilingual", text: "Write the dialogue in Hindi (Devanagari) and descriptions in English.", expect: ["script:dialogue:hindi", "script:description:english"] },
  { id: "d21", cat: "multilingual", text: "Escribe 3 ideas para una fiesta de cumpleaños.", expect: ["count:3:idea", "lang:spanish~"] },
  { id: "d22", cat: "hinglish", text: "bina emojis ke 4 captions likho Instagram ke liye", expect: ["count:4:caption", "exclude:emojis"] },
  { id: "d23", cat: "hinglish", text: "10 sawal do GK ke, answers ke saath", expect: ["count:10:question", "include:answers"] },
  { id: "d24", cat: "typos", text: "writ 6 secnes for a short flim, each 30-40 wrods", expect: ["count:6:scene", "words:30-40:item"] },
  { id: "d25", cat: "typos", text: "giv me 3 bulet points on AI risks, no intro", expect: ["count:3:bullet", "format:bullets", "no-commentary"] },
  { id: "d26", cat: "typos", text: "make a tabel of 5 countries and there capitals", expect: ["format:table", "count:5:country"] },
  { id: "d27", cat: "ambiguous", text: "Write something about it.", expect: ["ambiguous:topic"] },
  { id: "d28", cat: "ambiguous", text: "Make it better.", expect: ["ambiguous:reference"] },
  { id: "d29", cat: "ambiguous", text: "Translate this.", expect: ["ambiguous:missing-input"] },
  { id: "d30", cat: "creative", text: "Write a short story.", expect: ["deliverable:story", "length:short"] },
  { id: "d31", cat: "contradiction", text: "Write a detailed explanation in under 30 words.", expect: ["length:detailed", "words:-30:total", "conflict:length"] },
  { id: "d32", cat: "contradiction", text: "Give me 5 tips, actually make it 7.", expect: ["count:7:tip"], critical: ["count:7:tip"] },
  { id: "d33", cat: "contradiction", text: "Write at least 500 words but no more than 200 words.", expect: ["conflict:words"] },
  { id: "d34", cat: "contradiction", text: "Return JSON only, and also a markdown table.", expect: ["format:json", "format:table", "conflict:format"] },
  { id: "d35", cat: "contradiction", text: "Keep it formal but very casual.", expect: ["tone:formal", "tone:casual", "conflict:tone"] },
  { id: "d36", cat: "context", text: "Use the previous format for 4 more.", history: LIST_HIST, expect: ["ref:previous", "count:4:item"] },
  { id: "d37", cat: "context", text: "Keep the dialogue unchanged and rewrite only the descriptions.", expect: ["preserve:dialogue", "only:descriptions"] },
  { id: "d38", cat: "context", text: "Expand your first answer.", history: TWO_ANSWERS, expect: ["ref:first"] },
  { id: "d39", cat: "context", text: "Now do the same for Germany.", history: [U("Capital of France?"), A("Paris.")], expect: ["ref:previous"] },
  { id: "d40", cat: "context", text: "Make the last one shorter.", history: TWO_ANSWERS, expect: ["ref:previous", "length:short"] },
  { id: "d41", cat: "verbatim", text: 'Include this sentence exactly: "Quality is never an accident."', expect: ["verbatim:quality is never an accident."] },
  { id: "d42", cat: "verbatim", text: 'Use the tagline "Built for speed" word for word in the intro.', expect: ["verbatim:built for speed"] },
  { id: "d43", cat: "verbatim", text: "Don't change any of the names.", expect: ["preserve:names"] },
  { id: "d44", cat: "optional", text: "Write a blog post about remote work; a table would be nice if possible.", expect: ["deliverable:blog", "format:table?"] },
  { id: "d45", cat: "optional", text: "Suggest 5 band names, e.g. like 'The Midnight Owls'.", expect: ["count:5:name"] },
  { id: "d46", cat: "optional", text: "Write a poem, preferably rhyming.", expect: ["deliverable:poem", "include:rhyming?"] },
  { id: "d47", cat: "story", text: "Write a 10-scene story about a robot named Bolt; keep Bolt in every scene and keep continuity.", expect: ["deliverable:story", "count:10:scene", "name:bolt", "consistency"] },
  { id: "d48", cat: "story", text: "Create 12 prompts for AI video, each 4, 6 or 8 seconds, total video 60 seconds.", expect: ["count:12:prompt", "durations:4/6/8", "duration-total:60"] },
  { id: "d49", cat: "technical", text: "Write a SQL query to find the top 10 customers by revenue, ordered descending.", expect: ["format:code-sql", "order:descending"] },
  { id: "d50", cat: "business", text: "Draft a professional proposal for a client, include pricing and a timeline, and do not mention competitors.", expect: ["deliverable:proposal", "tone:professional", "include:pricing", "include:timeline", "exclude:competitors"] },
  { id: "d51", cat: "conditional", text: "Explain Kubernetes. If you use any jargon, define it.", expect: ["conditional"] },
  { id: "d52", cat: "business", text: "Write a cover letter in German, max 250 words.", expect: ["deliverable:letter", "lang:german", "words:-250:total"] },
  { id: "d53", cat: "format", text: "List 8 planets alphabetically, as bullets.", expect: ["count:8:planet", "order:alphabetical", "format:bullets"] },
];

export const HOLDOUT: BenchCase[] = [
  { id: "h01", cat: "typos", text: "Plz write 4 short poems abt the sea, no titles", expect: ["deliverable:poem", "count:4:poem", "length:short", "no-headings"] },
  { id: "h02", cat: "format", text: "Give 7 interview questions for a data analyst role in a table.", expect: ["count:7:question", "format:table"] },
  { id: "h03", cat: "hinglish", text: "Hindi mein 3 lines likho Diwali par", expect: ["count:3:line", "lang:hindi"] },
  { id: "h04", cat: "context", text: "Make the second answer more formal.", history: TWO_ANSWERS, expect: ["ref:second", "tone:formal"] },
  { id: "h05", cat: "business", text: "Write a product FAQ with 6 questions and avoid technical jargon.", expect: ["count:6:question", "exclude:technical jargon"] },
  { id: "h06", cat: "format", text: "Return CSV only with columns date, amount.", expect: ["format:csv", "no-commentary"] },
  { id: "h07", cat: "contradiction", text: "Explain recursion in depth but in under 50 words.", expect: ["length:detailed", "words:-50:total", "conflict:length"] },
  { id: "h08", cat: "verbatim", text: 'Start the email with "Dear Team," exactly.', expect: ["deliverable:email", "verbatim:dear team,"] },
  { id: "h09", cat: "creative", text: "Write a fun, friendly welcome message for new users.", expect: ["tone:friendly"] },
  { id: "h10", cat: "ambiguous", text: "Do it again.", expect: ["ambiguous:reference"] },
  { id: "h11", cat: "business", text: "Create 15 slides for an investor pitch, each under 30 words, and include a revenue slide.", expect: ["count:15:slide", "words:-30:item", "include:revenue slide"] },
  { id: "h12", cat: "optional", text: "Generate 20 names for a coffee shop, if possible with a nature theme.", expect: ["count:20:name", "include:nature theme?"] },
  { id: "h13", cat: "story", text: "Write 5 scenes in Hindi dialogue (Devanagari) with English descriptions.", expect: ["count:5:scene", "script:dialogue:hindi", "script:description:english"] },
  { id: "h14", cat: "business", text: "Summarise the meeting notes in 2 paragraphs and don't mention names.", expect: ["deliverable:summary", "count:2:paragraph", "exclude:names"] },
  { id: "h15", cat: "technical", text: "Write a Bash script to back up /var/www daily.", expect: ["format:code-bash"] },
];

// HOLDOUT2: written in one pass on 2026-10-16 before the upgraded engine was run on them; never tuned against.
export const HOLDOUT2: BenchCase[] = [
  { id: "x01", cat: "simple", text: "Give me 4 reasons to learn Rust.", expect: ["count:4:reason"] },
  { id: "x02", cat: "format", text: "Output the list of users as CSV only.", expect: ["format:csv", "no-commentary"] },
  { id: "x03", cat: "multi", text: "Write 6 taglines for a coffee shop, each under 10 words, in a humorous tone.", expect: ["count:6:tagline", "words:-10:item", "tone:humorous"] },
  { id: "x04", cat: "business", text: "Draft a professional email to a client about the delayed shipment. Don't mention the warehouse fire.", expect: ["deliverable:email", "tone:professional", "exclude:warehouse fire"] },
  { id: "x05", cat: "hinglish", text: "Hindi mein 3 sawal likho about cricket.", expect: ["count:3:question", "lang:hindi"] },
  { id: "x06", cat: "multilingual", text: "Écris une courte histoire pour les enfants avec un dragon.", expect: ["lang:french~"] },
  { id: "x07", cat: "typos", text: "writ 5 promts for a sci-fi flim", expect: ["count:5:prompt"] },
  { id: "x08", cat: "ambiguous", text: "Translate this.", expect: ["ambiguous:missing-input"] },
  { id: "x09", cat: "contradiction", text: "Give me 3 ideas, no wait, 6.", expect: ["count:6:idea"] },
  { id: "x10", cat: "contradiction", text: "Make it short but detailed and comprehensive.", expect: ["length:short", "length:detailed", "conflict:length"] },
  { id: "x11", cat: "context", history: [U("Write a slogan for a gym."), A("Stronger every day.")], text: "Do the same for a bakery.", expect: ["ref:previous"] },
  { id: "x12", cat: "verbatim", text: "Start the reply exactly with \"Hello world\" and then explain recursion.", expect: ["verbatim:hello world"] },
  { id: "x13", cat: "optional", text: "Write a product description, preferably with a call to action.", expect: ["include:call to action?"] },
  { id: "x14", cat: "technical", text: "Write a SQL query that lists orders sorted in descending order of total.", expect: ["format:code-sql", "order:descending"] },
  { id: "x15", cat: "story", text: "Write 10 scenes of a mystery story, each between 40 and 60 words, with consistent characters.", expect: ["count:10:scene", "deliverable:story", "words:40-60:item", "consistency"] },
  { id: "x16", cat: "conditional", text: "If the user is under 18, show a warning message.", expect: ["conditional"] },
  { id: "x17", cat: "format", text: "Answer in a table and keep it under 100 words.", expect: ["format:table", "words:-100:total"] },
  { id: "x18", cat: "business", text: "Write a formal report on Q3 sales in English, without any headings.", expect: ["deliverable:report", "tone:formal", "lang:english", "no-headings"] },
  { id: "x19", cat: "creative", text: "Write a funny poem about cats in Spanish.", expect: ["deliverable:poem", "tone:humorous", "lang:spanish"] },
  { id: "x20", cat: "simple", text: "How does a refrigerator work?", expect: [] },
];
