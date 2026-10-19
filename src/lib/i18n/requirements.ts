// Language-aware requirement extraction for the 15 supported languages. Pure, deterministic, browser-safe.
// Each concept (count noun, length unit, bound, format, exclusion, deliverable, tone, length) is a small
// per-language lexicon; adding a language means adding words here, not new code paths.
// Evidence always keeps the user's original wording; values are normalized for checking.
import { normalizeText } from "./locales";

export type Add = (kind: string, value: string, evidence: string, o?: { mandatory?: boolean; source?: "explicit" | "inferred" }) => void;
const rx = (words: string[], flags = "giu") => new RegExp(`(?:${words.map((w) => w.normalize("NFC")).join("|")})`, flags);

/** Count nouns → English singular. Stems: matched as a prefix of the word, so inflections (советов/совета) work. */
const NOUNS: Record<string, string[]> = {
  tip: ["consejos?", "conseils?", "tipps?", "совет", "dicas?", "tips?", "सुझाव", "टिप्स", "建议", "建議", "技巧", "コツ", "ヒント", "팁", "조언", "نصائح", "نصيحة", "مشورے", "تجاویز", "টিপস", "পরামর্শ", "குறிப்பு", "ஆலோசனை"],
  idea: ["ideas?", "idées?", "ideen?", "иде[йия]", "ideias?", "ide", "विचार", "आइडिया", "点子", "點子", "想法", "主意", "アイデア", "アイディア", "아이디어", "أفكار", "فكرة", "خیالات", "آئیڈیاز", "আইডিয়া", "ধারণা", "யோசனை"],
  question: ["preguntas?", "questions?", "fragen?", "вопрос", "perguntas?", "pertanyaan", "प्रश्न", "सवाल", "问题", "問題", "質問", "질문", "أسئلة", "سؤال", "سوالات", "سوال", "প্রশ্ন", "கேள்வி"],
  step: ["pasos?", "étapes?", "schritte?", "шаг", "passos?", "langkah", "चरण", "步骤", "步驟", "ステップ", "手順", "단계", "خطوات", "مراحل", "ধাপ", "படி"],
  paragraph: ["párrafos?", "paragraphes?", "absätze", "absatz", "абзац", "parágrafos?", "paragraf", "अनुच्छेद", "पैराग्राफ", "段落", "문단", "단락", "فقرات", "فقرة", "پیراگراف", "অনুচ্ছেদ", "பத்தி"],
  sentence: ["frases?", "oraciones?", "phrases?", "sätze", "satz", "предложени", "kalimat", "वाक्य", "句话", "句話", "문장", "جمل", "جملے", "বাক্য", "வாக்கிய"],
  caption: ["captions?", "कैप्शन", "キャプション", "캡션", "تعليقات", "کیپشن", "ক্যাপশন"],
  country: ["países", "pays", "ländern?", "стран", "negara", "देश", "国家", "國家", "か国", "나라", "국가", "دول", "ممالک", "দেশ", "நாடு"],
  example: ["ejemplos?", "exemples?", "beispiele?", "пример", "exemplos?", "contoh", "उदाहरण", "例子", "例", "예시", "أمثلة", "مثالیں", "উদাহরণ", "உதாரண"],
  reason: ["razones", "raisons?", "gründe", "причин", "razões", "alasan", "कारण", "理由", "이유", "أسباب", "وجوہات", "কারণ", "காரண"],
};
const NOUN_RES = Object.entries(NOUNS).map(([n, ws]) => [n, rx(ws.map((w) => (/^[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(w) ? `${w}(?![\\p{Script=Latin}])` : w)), "iu")] as const);
const COUNTERS = /^\s*(?:个|個|つ|개|가지|টি|টা|ta)?/u;

const WORD_UNIT = ["palabras?", "mots?", "wörtern?", "wort", "слов", "palavras?", "kata", "शब्द", "كلمات", "كلمة", "الفاظ", "لفظ", "শব্দ", "வார்த்தை", "단어", "語(?!で)", "単語", "词", "詞"];
const CHAR_UNIT = ["caracteres", "caractères", "zeichen", "символ", "karakter", "अक्षर", "حرف", "অক্ষর", "எழுத்து", "文字", "字", "자", "글자"];
const MAX = ["máximo", "no máximo", "máx", "pas plus de", "au plus", "au maximum", "maximum", "höchstens", "maximal", "weniger als", "unter", "не более", "не больше", "до", "менее", "меньше", "maksimal", "kurang dari", "tidak lebih", "paling banyak", "menos de", "moins de", "以内", "以下", "不超过", "不超過", "以內", "最多", "이내", "이하", "لا يزيد", "لا تزيد", "أقل من", "سے کم", "سے زیادہ نہیں", "से कम", "से ज़्यादा नहीं", "से अधिक नहीं", "মধ্যে", "এর কম", "কম", "க்குள்", "குள்"];
const MIN = ["al menos", "como mínimo", "mínimo", "au moins", "mindestens", "не менее", "не меньше", "minimal", "setidaknya", "paling sedikit", "pelo menos", "no mínimo", "至少", "以上", "이상", "على الأقل", "کم از کم", "कम से कम", "অন্তত", "குறைந்தது"];
const RANGE = ["-", "–", "~", "〜", "a", "y", "e", "et", "und", "bis", "à", "до", "и", "到", "至", "से", "sampai", "hingga", "dan", "এবং", "থেকে", "முதல்", "و", "سے", "～"];
const EACH = ["cada", "chaque", "jede[rsn]?", "кажд", "setiap", "tiap", "हर", "प्रत्येक", "每", "各", "각", "كل", "ہر", "প্রতিটি", "ஒவ்வொரு"];

const FORMATS: [string, string[]][] = [
  ["table", ["tablas?", "tableau", "tabelle", "таблиц", "tabela", "tabel", "तालिका", "टेबल", "表格", "表に", "表で", "表を", "表形式", "표로", "표를", "표 형식", "جدول", "টেবিল", "அட்டவணை"]],
  ["numbered", ["lista numerada", "liste numérotée", "nummerierte", "нумерованн", "daftar bernomor", "क्रमांकित", "编号", "編號", "番号付き", "번호 목록", "번호를 매긴", "مرقمة", "نمبر وار", "নম্বরযুক্ত", "எண்ணிட்ட"]],
  ["bullets", ["viñetas", "puces", "aufzählungspunkt", "маркированн", "marcadores", "tópicos", "poin-poin", "बुलेट", "项目符号", "項目符號", "箇条書き", "글머리", "نقاط", "بلٹ", "বুলেট", "புள்ளி"]],
];
const ONLY = ["solo", "sólo", "solamente", "únicamente", "uniquement", "seulement", "nur", "только", "apenas", "somente", "hanya", "केवल", "सिर्फ़", "सिर्फ", "只", "のみ", "だけ", "만", "فقط", "صرف", "শুধু", "மட்டும்"];
const DELIVERABLES: [string, string[]][] = [
  ["email", ["correo", "e-mail", "email", "courriel", "ईमेल", "邮件", "郵件", "メール", "이메일", "بريد إلكتروني", "ای میل", "ইমেল", "ইমেইল", "மின்னஞ்சல்"]],
  ["letter", ["carta", "lettre", "brief", "письмо", "surat", "पत्र", "书信", "書信", "手紙", "편지", "رسالة", "خط", "চিঠি", "கடிதம்"]],
  ["poem", ["poema", "poème", "gedicht", "стихотворени", "стих", "puisi", "कविता", "诗", "詩", "시를", "시 ", "قصيدة", "نظم", "কবিতা", "கவிதை"]],
  ["story", ["historia", "histoire", "geschichte", "рассказ", "история", "história", "cerita", "कहानी", "故事", "物語", "이야기", "قصة", "کہانی", "গল্প", "கதை"]],
  ["summary", ["resume", "resumen", "résume", "résumé", "zusammenfass", "fass\\w*\\b[^.]{0,40}zusammen", "резюме", "resuma", "resumo", "ringkas", "सारांश", "总结", "總結", "摘要", "要約", "요약", "لخص", "ملخص", "خلاصہ", "সারাংশ", "சுருக்க"]],
  ["essay", ["ensayo", "essai", "aufsatz", "эссе", "redação", "esai", "निबंध", "作文", "论文", "論文", "エッセイ", "에세이", "مقال", "مضمون", "প্রবন্ধ", "கட்டுரை"]],
  ["report", ["informe", "rapport", "bericht", "отчёт", "отчет", "relatório", "laporan", "रिपोर्ट", "报告", "報告", "レポート", "보고서", "تقرير", "رپورٹ", "রিপোর্ট", "அறிக்கை"]],
];
const TONES: [string, string[]][] = [
  ["formal", ["formal", "formel", "официальн", "औपचारिक", "正式", "フォーマル", "공식적", "격식", "رسمي", "رسمی", "আনুষ্ঠানিক", "முறையான"]],
  ["professional", ["profesional", "professionnel", "professionell", "профессиональн", "profissional", "पेशेवर", "专业", "專業", "プロフェッショナル", "전문적", "احترافي", "پیشہ ورانہ", "পেশাদার", "தொழில்முறை"]],
  ["friendly", ["amigable", "amical", "freundlich", "дружелюбн", "amigável", "ramah", "मैत्रीपूर्ण", "友好", "フレンドリー", "친근한", "ودي", "دوستانہ", "বন্ধুত্বপূর্ণ", "நட்பான"]],
  ["humorous", ["divertido", "drôle", "humorvoll", "lustig", "смешн", "engraçado", "lucu", "मज़ेदार", "मजेदार", "幽默", "面白い", "재미있는", "مضحك", "مزاحیہ", "মজার", "நகைச்சுவை"]],
];
const SHORT = ["corto", "corta", "court", "courte", "kurz", "коротк", "кратк", "curto", "curta", "pendek", "छोटी", "छोटा", "संक्षिप्त", "短", "简短", "簡短", "短い", "짧은", "간단", "قصير", "مختصر", "ছোট", "সংক্ষিপ্ত", "சிறிய", "சுருக்கமான"];
const DETAILED = ["detallad", "détaillé", "ausführlich", "подробн", "detalhad", "yang detail", "secara detail", "विस्तार", "详细", "詳細", "詳しく", "자세하게", "자세히", "بالتفصيل", "تفصیل", "تفصيل", "বিস্তারিত", "விரிவாக"];
const VERBATIM = ["exactamente", "tal cual", "exactement", "genau", "wörtlich", "точно", "дословно", "exatamente", "persis", "ठीक इसी", "हूबहू", "原样", "原樣", "一字不差", "そのまま", "그대로", "حرفيا", "بالضبط", "بعینہ", "হুবহু", "அப்படியே"];

const latinish = (w: string) => /^[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(w);
const wordRx = (ws: string[], flags = "iu") => new RegExp(ws.map((w) => (latinish(w) ? `(?<![\\p{L}])${w}` : w)).join("|"), flags);
const UNIT_W = wordRx(WORD_UNIT), UNIT_C = wordRx(CHAR_UNIT);
const MAX_RE = wordRx(MAX), MIN_RE = wordRx(MIN), EACH_RE = wordRx(EACH);

/** Language-aware requirements; only called for text that is not plain English (English keeps its own rules). */
export function multilingualRequirements(raw: string, add: Add, has: (kind: string) => boolean) {
  const t = normalizeText(raw);
  const clauseStart = (i: number) => Math.max(...["。", ".", ";", "；", "\n", "!", "?", "।", "۔", "،"].map((p) => t.lastIndexOf(p, i - 1))) + 1;

  // Length limits: number(s) + unit, bound markers in a small window around them.
  const lenRe = /(\d{1,6})(?:\s*(?:-|–|~|〜|～|a|y|e|et|und|bis|à|до|и|到|至|से|sampai|hingga|dan|থেকে|و|سے)\s*(\d{1,6}))?\s*/gu;
  for (const m of t.matchAll(lenRe)) {
    const i = m.index ?? 0, after = t.slice(i + m[0].length, i + m[0].length + 14);
    const um = UNIT_W.exec(after), cm = UNIT_C.exec(after);
    const unitAt = (x: RegExpExecArray | null) => (x && x.index <= 1 ? x : null);
    const isWord = unitAt(um), isChar = !isWord ? unitAt(cm) : null;
    if (!isWord && !isChar) continue;
    const before = t.slice(Math.max(clauseStart(i), i - 24), i), tail = t.slice(i + m[0].length, i + m[0].length + 30);
    const ctx = before + " " + tail;
    const scope = EACH_RE.test(t.slice(clauseStart(i), i)) ? "item" : "total";
    const ev = raw.normalize("NFC").slice(Math.max(0, i - 12), i + m[0].length + 12).trim() || m[0];
    let lo: string = "", hi: string = "";
    if (m[2]) { lo = m[1]; hi = m[2]; if (Number(lo) > Number(hi)) [lo, hi] = [hi, lo]; }
    else if (MIN_RE.test(ctx)) lo = m[1]; // checked first: "не менее" (min) contains "менее" (max)
    else if (MAX_RE.test(ctx)) hi = m[1];
    else continue;
    if (isWord && !has("words")) add("words", `${lo}-${hi}:${scope}`, ev);
    if (isChar && !has("chars")) add("chars", m[2] ? `${lo}-${hi}` : hi && scope === "item" ? `${hi}:item` : hi || `${lo}-`, ev);
  }

  // Counts: first digit followed (or, with a counter, preceded) by a known noun.
  if (!has("count")) {
    for (const m of t.matchAll(/(\d{1,4})/g)) {
      const i = m.index ?? 0, n = Number(m[1]); if (n < 1) continue;
      const rest = t.slice(i + m[1].length);
      const counter = COUNTERS.exec(rest)?.[0] ?? "";
      if (UNIT_W.exec(rest.slice(0, 4))?.index === 0 || UNIT_C.exec(rest.replace(/^\s+/, "").slice(0, 3))?.index === 0) continue;
      const win = rest.slice(counter.length, counter.length + 18).replace(/^\s+/, "");
      let hit = NOUN_RES.find(([, re]) => { const x = re.exec(win.split(/[\d,.;:。、，！？!?]/)[0]); return x != null && x.index <= 10; });
      if (!hit && counter.trim()) { const prev = t.slice(Math.max(0, i - 12), i); hit = NOUN_RES.find(([, re]) => re.test(prev)); }
      if (hit) { add("count", `${n}:${hit[0]}`, `${m[1]}${rest.slice(0, 16)}`.trim()); break; }
    }
  }

  for (const [name, ws] of FORMATS) { const m = wordRx(ws).exec(t); if (m) add("format", name, m[0]); }
  const fmtWord = /json|csv|yaml|xml|code|代码|代碼|コード|코드|tabla|tableau|tabelle|таблиц|tabela|tabel|तालिका|表格|表|표|جدول|টেবিল|অ্যারে|அட்டவணை/iu;
  for (const m of t.matchAll(new RegExp(wordRx(ONLY).source, "giu"))) {
    const i = m.index ?? 0, win = t.slice(Math.max(0, i - 12), i + m[0].length + 14);
    if (fmtWord.test(win)) { add("no-commentary", "", win.trim()); break; }
  }

  // Exclusions: prefix markers (sin/sans/ohne/без/sem/tanpa/بدون/不要…) and postfix markers (なし/없이/के बिना/کے بغیر/ছাড়া/இல்லாமல்).
  const stop = "[.,;:!?。，、；！？।۔،\\n]";
  for (const m of t.matchAll(new RegExp(`(?<![\\p{L}])(?:sin|sans|ohne|без|sem|tanpa|بدون|بلا)\\s+((?:[\\p{L}\\p{M}'-]+\\s?){1,3}?)(?=${stop}|$)`, "giu"))) add("exclude", m[1].trim().toLowerCase(), m[0]);
  for (const m of t.matchAll(new RegExp(`(?:不要|别|別|不得|切勿)(?:使用|提到|提及|包含|用|写|寫|出现|出現|有)?([^${stop.slice(1, -1)}]{1,12})`, "gu"))) add("exclude", m[1].trim(), m[0]);
  for (const m of t.matchAll(/([\p{Script=Han}\p{Script=Katakana}ー]{1,10})(?:なし|無し|抜き)/gu)) add("exclude", m[1], m[0]);
  for (const m of t.matchAll(/([\p{Script=Hangul}A-Za-z]{1,12})\s*없이/gu)) add("exclude", m[1], m[0]);
  for (const m of t.matchAll(/बिना\s+([\p{L}\p{M}]+(?:\s+[\p{L}\p{M}]+)?)\s+के/gu)) add("exclude", m[1], m[0]);
  for (const m of t.matchAll(/([\p{L}\p{M}]+)\s+के\s+बिना/gu)) add("exclude", m[1], m[0]);
  for (const m of t.matchAll(/([\p{L}\p{M}]+)\s+کے\s+بغیر/gu)) add("exclude", m[1], m[0]);
  for (const m of t.matchAll(/([\p{L}\p{M}]+)\s+ছাড়া/gu)) add("exclude", m[1], m[0]);
  for (const m of t.matchAll(/([\p{L}\p{M}]+)\s+இல்லாமல்/gu)) add("exclude", m[1], m[0]);

  for (const [name, ws] of DELIVERABLES) { const m = wordRx(ws).exec(t); if (m && !(name === "letter" && has("deliverable:email"))) add("deliverable", name, m[0]); }
  for (const [name, ws] of TONES) { const m = wordRx(ws).exec(t); if (m) add("tone", name, m[0]); }
  const sh = wordRx(SHORT).exec(t), de = wordRx(DETAILED).exec(t);
  if (sh) add("length", "short", sh[0]);
  if (de) add("length", "detailed", de[0]);
  if (wordRx(VERBATIM).test(t)) for (const m of t.matchAll(/["“«「『]([^"”»」』\n]{2,300})["”»」』]/gu)) add("verbatim", m[1].toLowerCase(), m[0]);
}
