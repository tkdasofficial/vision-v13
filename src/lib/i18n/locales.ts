// Central locale configuration (16 configs / 15 language families). Pure and browser-safe.
// Everything language-specific that other modules need (script, direction, fonts, detection hints,
// names used to request a language) lives here — never as scattered conditionals elsewhere.
export type ScriptId = "latin" | "devanagari" | "han-simplified" | "han-traditional" | "cyrillic" | "japanese" | "hangul" | "arabic" | "bengali" | "tamil";
export type LocaleConfig = {
  id: string; name: string; /** value used in requirement atoms (lang:<key>) */ key: string; nativeName: string;
  script: ScriptId; dir: "ltr" | "rtl";
  /** CSS/DOCX font family preference, best first. */ fonts: string[];
  /** Font file for PDF embedding (fetched once per worker and cached). */ pdfFont: string;
  numberLocale: string;
};

const NOTO = (fam: string, file: string) => `https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/${fam}/hinted/ttf/${file}`;
const FS = (fam: string, subset: string) => `https://cdn.jsdelivr.net/fontsource/fonts/${fam}@latest/${subset}-400-normal.ttf`;
const LATIN = NOTO("NotoSans", "NotoSans-Regular.ttf");

export const LOCALES: LocaleConfig[] = [
  { id: "en", name: "English", key: "english", nativeName: "English", script: "latin", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "en-US" },
  { id: "hi", name: "Hindi", key: "hindi", nativeName: "हिन्दी", script: "devanagari", dir: "ltr", fonts: ["Noto Sans Devanagari", "Mangal", "Nirmala UI"], pdfFont: NOTO("NotoSansDevanagari", "NotoSansDevanagari-Regular.ttf"), numberLocale: "hi-IN" },
  { id: "zh-CN", name: "Chinese (Simplified)", key: "chinese-simplified", nativeName: "简体中文", script: "han-simplified", dir: "ltr", fonts: ["Noto Sans SC", "Microsoft YaHei", "PingFang SC"], pdfFont: FS("noto-sans-sc", "chinese-simplified"), numberLocale: "zh-CN" },
  { id: "zh-TW", name: "Chinese (Traditional)", key: "chinese-traditional", nativeName: "繁體中文", script: "han-traditional", dir: "ltr", fonts: ["Noto Sans TC", "Microsoft JhengHei", "PingFang TC"], pdfFont: FS("noto-sans-tc", "chinese-traditional"), numberLocale: "zh-TW" },
  { id: "ru", name: "Russian", key: "russian", nativeName: "Русский", script: "cyrillic", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "ru-RU" },
  { id: "es", name: "Spanish", key: "spanish", nativeName: "Español", script: "latin", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "es-ES" },
  { id: "fr", name: "French", key: "french", nativeName: "Français", script: "latin", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "fr-FR" },
  { id: "de", name: "German", key: "german", nativeName: "Deutsch", script: "latin", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "de-DE" },
  { id: "ja", name: "Japanese", key: "japanese", nativeName: "日本語", script: "japanese", dir: "ltr", fonts: ["Noto Sans JP", "Yu Gothic", "Meiryo"], pdfFont: FS("noto-sans-jp", "japanese"), numberLocale: "ja-JP" },
  { id: "ko", name: "Korean", key: "korean", nativeName: "한국어", script: "hangul", dir: "ltr", fonts: ["Noto Sans KR", "Malgun Gothic"], pdfFont: FS("noto-sans-kr", "korean"), numberLocale: "ko-KR" },
  { id: "ar", name: "Arabic", key: "arabic", nativeName: "العربية", script: "arabic", dir: "rtl", fonts: ["Noto Naskh Arabic", "Arial"], pdfFont: NOTO("NotoNaskhArabic", "NotoNaskhArabic-Regular.ttf"), numberLocale: "ar" },
  { id: "pt", name: "Portuguese", key: "portuguese", nativeName: "Português", script: "latin", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "pt-BR" },
  { id: "id", name: "Indonesian", key: "indonesian", nativeName: "Bahasa Indonesia", script: "latin", dir: "ltr", fonts: ["Noto Sans", "Arial"], pdfFont: LATIN, numberLocale: "id-ID" },
  // Naskh (not Nastaliq) for PDFs: the PDF writer shapes joins but not Nastaliq's diagonal stacking.
  { id: "ur", name: "Urdu", key: "urdu", nativeName: "اردو", script: "arabic", dir: "rtl", fonts: ["Noto Nastaliq Urdu", "Noto Naskh Arabic", "Arial"], pdfFont: NOTO("NotoNaskhArabic", "NotoNaskhArabic-Regular.ttf"), numberLocale: "ur-PK" },
  { id: "bn", name: "Bengali", key: "bengali", nativeName: "বাংলা", script: "bengali", dir: "ltr", fonts: ["Noto Sans Bengali", "Vrinda", "Nirmala UI"], /* Serif: fontkit misplaces vowel signs with the Sans build (checked by rendering). */ pdfFont: NOTO("NotoSerifBengali", "NotoSerifBengali-Regular.ttf"), numberLocale: "bn-BD" },
  { id: "ta", name: "Tamil", key: "tamil", nativeName: "தமிழ்", script: "tamil", dir: "ltr", fonts: ["Noto Sans Tamil", "Latha", "Nirmala UI"], pdfFont: NOTO("NotoSansTamil", "NotoSansTamil-Regular.ttf"), numberLocale: "ta-IN" },
];
export const localeById = (id: string) => LOCALES.find((l) => l.id === id);
export const localeByKey = (key: string) => LOCALES.find((l) => l.key === key) ?? (key === "chinese" ? localeById("zh-CN") : key === "bangla" ? localeById("bn") : undefined);

// ---------- text normalization ----------
const DIGIT_BLOCKS = [0x0966, 0x09e6, 0x0660, 0x06f0, 0x0be6, 0xff10];
/** NFC + native digits (Devanagari, Bengali, Arabic-Indic, Extended Arabic, Tamil, full-width) → ASCII. */
export function normalizeText(t: string): string {
  return t.normalize("NFC").replace(/[\u0966-\u096f\u09e6-\u09ef\u0660-\u0669\u06f0-\u06f9\u0be6-\u0bef\uff10-\uff19]/g, (d) => {
    const c = d.charCodeAt(0); const base = DIGIT_BLOCKS.find((b) => c >= b && c <= b + 9)!; return String(c - base);
  });
}

// ---------- Chinese variant detection ----------
const PAIRS = "这這 个個 们們 来來 为為 说說 时時 对對 会會 学學 国國 语語 话話 么麼 写寫 给給 请請 问問 发發 经經 东東 车車 门門 见見 开開 关關 长長 难難 认認 让讓 识識 书書 买買 卖賣 电電 动動 运運 过過 还還 进進 远遠 选選 边邊 钱錢 银銀 错錯 键鍵 铁鐵 钟鐘 间間 题題 论論 设設 试試 读讀 谁誰 调調 谈談 点點 编編 较較 种種 号號 议議 习習 总總 结結 详詳 细細 讲講 绍紹 体體 简簡 区區 块塊 链鏈 邮郵 师師 湾灣 诗詩 风風 项項 内內 几幾 岁歲 销銷 头頭 现現 实實 际際 员員 报報 样樣 产產 业業 务務 专專 处處 备備 杂雜 单單 变變 态態 质質 级級 线線 组組 织織 网網 络絡 页頁 码碼 节節 万萬 与與 从從 优優 传傳 价價 乐樂 亲親 亿億 应應 当當 并並 无無 爱愛 气氣 华華 汉漢 宝寶 带帶 帮幫 广廣 张張 归歸 录錄 忆憶 怀懷 恶惡 惯慣 战戰 户戶 护護 择擇 换換 数數 断斷 旧舊 显顯 术術 机機 权權 条條 极極 构構 标標 欢歡 测測 满滿 灵靈 热熱 状狀 独獨 环環 画畫 确確 礼禮 离離 积積 称稱 笔筆 类類 红紅 纪紀 约約 纸紙 练練 维維 综綜 绿綠 罗羅 职職 联聯 听聽 胜勝 脑腦 艺藝 药藥 获獲 虽雖 观觀 规規 视視 览覽 觉覺 计計 记記 许許 证證 评評 诉訴 词詞 译譯 误誤 课課 谢謝 负負 财財 购購 资資 赛賽 轻輕 输輸 达達 释釋 闭閉 闻聞 阅閱 队隊 阳陽 阴陰 陆陸 随隨 险險 静靜 韩韓 顶頂 顺順 须須 顾顧 预預 领領 颜顏 额額 飞飛 饭飯 马馬 验驗 鱼魚 鸟鳥 黄黃 龙龍 飓颶 台颱";
const SIMP = new Set<string>(), TRAD = new Set<string>();
for (const p of PAIRS.split(" ")) { const [s, t] = [...p]; if (s !== t) { SIMP.add(s); TRAD.add(t); } }
SIMP.delete("台"); // 台 is also standard in Traditional text (台灣); only 颱 is diagnostic.
export function chineseVariant(t: string): "zh-CN" | "zh-TW" | null {
  let s = 0, tr = 0; for (const ch of t) { if (SIMP.has(ch)) s++; else if (TRAD.has(ch)) tr++; }
  return s > tr ? "zh-CN" : tr > s ? "zh-TW" : null;
}

// ---------- request-language detection (what the user wrote in; never the requested output language) ----------
const LATIN_HINTS: [string, RegExp, RegExp?][] = [
  ["es", /(?<![\p{L}])(escribe|dame|haz|un|una|unos|del|al|y|menos|mi|los|las|cómo|qué|por favor|para|consejos|sobre|con|sin|en|el|este|esta|responde|cada|debe|lista|tabla)(?![\p{L}])/giu, /[ñ¿¡]/],
  ["pt", /(?<![\p{L}])(escreva|me dê|dê|faça|uma|você|não|com|sem|para|em|dicas|sobre|responda|retorne|apenas|cada|deve|resuma|liste|lista|tabela|exemplos|de verbos|por favor)(?![\p{L}])/giu, /[ãõ]|ção\b/],
  ["fr", /(?<![\p{L}])(propose|au|aux|et|je|moi|écris|donne|fais|une|des|avec|sans|pour|le|la|les|du|vous|est|en|réponds|liste|renvoie|uniquement|chaque|doit|résume)(?![\p{L}])/giu, /[èêœ]|\b(?:qu'|l'|d')/],
  ["de", /(?<![\p{L}])(schreibe|schreib|gib|mir|eine|einen|und|mit|ohne|für|der|das|den|ist|bitte|nenne|erstelle|zurück|jeder|soll|über|auf)(?![\p{L}])/giu, /[ßäöü]/],
  ["id", /(?<![\p{L}])(tulis|berikan|buat|dan|yang|untuk|dengan|tanpa|dalam|tentang|ini|itu|kata|saya|kepada|setiap|harus|hanya|kembalikan|ringkas|tolong|jawab|daftar)(?![\p{L}])/giu],
];
export function detectLocale(text: string): string | null {
  const t = normalizeText(text);
  const letters = (t.match(/\p{L}/gu) ?? []).length || 1;
  const share = (re: RegExp) => (t.match(re) ?? []).length / letters;
  if (/[\u0904-\u0939\u093d-\u094d\u0950-\u0963]/.test(t)) return "hi"; // letters only: the danda "।" is shared with Bengali
  if (share(/[\u0980-\u09ff]/g) > 0.2) return "bn";
  if (share(/[\u0b80-\u0bff]/g) > 0.2) return "ta";
  if (share(/[\u3040-\u30ff]/g) > 0.05) return "ja";
  if (share(/[\uac00-\ud7af\u1100-\u11ff]/g) > 0.2) return "ko";
  if (share(/\p{Script=Han}/gu) > 0.2) return chineseVariant(t) ?? "zh-CN";
  if (share(/\p{Script=Arabic}/gu) > 0.2) return /[ٹڈڑںےۓہھ]/.test(t) ? "ur" : "ar";
  if (share(/\p{Script=Cyrillic}/gu) > 0.3) return "ru";
  let best: [string, number] = ["", 0];
  for (const [id, words, chars] of LATIN_HINTS) { const n = (t.match(words) ?? []).length + (chars?.test(t) ? 2 : 0); if (n > best[1]) best = [id, n]; }
  return best[1] >= 2 ? best[0] : null;
}

// ---------- explicit output-language requests in any target language ----------
// Each entry: target key → aliases per writing system. Frames decide whether a mention means "write in X".
type Alias = { key: string; latin?: string[]; cyr?: string[]; zh?: string[]; ja?: string[]; ko?: string[]; hi?: string[]; ar?: string[]; ur?: string[]; bn?: string[]; ta?: string[] };
const ALIASES: Alias[] = [
  { key: "english", latin: ["inglés", "ingles", "anglais", "englisch", "inglês", "inggris"], cyr: ["английск", "по-английски"], zh: ["英文", "英语", "英語"], ja: ["英語"], ko: ["영어"], hi: ["अंग्रेज़ी", "अंग्रेजी", "इंग्लिश"], ar: ["إنجليزية", "انجليزية", "إنكليزية"], ur: ["انگریزی"], bn: ["ইংরেজি"], ta: ["ஆங்கில"] },
  { key: "hindi", latin: ["hindi", "hindí"], cyr: ["хинди"], zh: ["印地语", "印地語"], ja: ["ヒンディー語"], ko: ["힌디어"], hi: ["हिंदी", "हिन्दी"], ar: ["هندية"], ur: ["ہندی"], bn: ["হিন্দি"], ta: ["ஹிந்தி", "இந்தி"] },
  { key: "chinese-simplified", latin: ["chino simplificado", "chinois simplifié", "vereinfachtem chinesisch", "chinês simplificado", "mandarin sederhana"], zh: ["简体中文", "簡體中文", "简体", "簡體"], ja: ["簡体字中国語", "簡体字"] },
  { key: "chinese-traditional", latin: ["chino tradicional", "chinois traditionnel", "traditionellem chinesisch", "chinês tradicional"], zh: ["繁体中文", "繁體中文", "繁体", "繁體"], ja: ["繁体字中国語", "繁体字"] },
  { key: "chinese", latin: ["chino", "chinois", "chinesisch", "chinês", "mandarin"], cyr: ["китайск"], zh: ["中文", "汉语", "漢語"], ja: ["中国語"], ko: ["중국어"], hi: ["चीनी"], ar: ["صينية"], ur: ["چینی"], bn: ["চীনা"], ta: ["சீன"] },
  { key: "russian", latin: ["ruso", "russe", "russisch", "russo", "rusia"], cyr: ["русск", "по-русски"], zh: ["俄语", "俄語", "俄文"], ja: ["ロシア語"], ko: ["러시아어"], hi: ["रूसी"], ar: ["روسية"], ur: ["روسی"], bn: ["রুশ"], ta: ["ரஷ்ய"] },
  { key: "spanish", latin: ["español", "espagnol", "spanisch", "espanhol", "spanyol"], cyr: ["испанск"], zh: ["西班牙语", "西班牙語"], ja: ["スペイン語"], ko: ["스페인어"], hi: ["स्पेनिश"], ar: ["إسبانية", "اسبانية"], ur: ["ہسپانوی"], bn: ["স্প্যানিশ"], ta: ["ஸ்பானிஷ"] },
  { key: "french", latin: ["francés", "frances", "français", "französisch", "francês", "prancis"], cyr: ["французск", "по-французски"], zh: ["法语", "法語", "法文"], ja: ["フランス語"], ko: ["프랑스어"], hi: ["फ्रेंच", "फ़्रेंच", "फ्रांसीसी"], ar: ["فرنسية"], ur: ["فرانسیسی"], bn: ["ফরাসি"], ta: ["பிரெஞ்சு"] },
  { key: "german", latin: ["alemán", "aleman", "allemand", "deutsch", "alemão", "jerman"], cyr: ["немецк", "по-немецки"], zh: ["德语", "德語", "德文"], ja: ["ドイツ語"], ko: ["독일어"], hi: ["जर्मन"], ar: ["ألمانية", "المانية"], ur: ["جرمن"], bn: ["জার্মান"], ta: ["ஜெர்மன்"] },
  { key: "japanese", latin: ["japonés", "japones", "japonais", "japanisch", "japonês", "jepang"], cyr: ["японск"], zh: ["日语", "日語", "日文"], ja: ["日本語"], ko: ["일본어"], hi: ["जापानी"], ar: ["يابانية"], ur: ["جاپانی"], bn: ["জাপানি"], ta: ["ஜப்பானிய"] },
  { key: "korean", latin: ["coreano", "coréen", "koreanisch", "korea"], cyr: ["корейск"], zh: ["韩语", "韓語", "韩文", "韓文"], ja: ["韓国語"], ko: ["한국어"], hi: ["कोरियाई"], ar: ["كورية"], ur: ["کوریائی"], bn: ["কোরিয়ান"], ta: ["கொரிய"] },
  { key: "arabic", latin: ["árabe", "arabe", "arabisch", "arab"], cyr: ["арабск"], zh: ["阿拉伯语", "阿拉伯語"], ja: ["アラビア語"], ko: ["아랍어"], hi: ["अरबी"], ar: ["عربية"], ur: ["عربی"], bn: ["আরবি"], ta: ["அரபு"] },
  { key: "portuguese", latin: ["portugués", "portugues", "portugais", "portugiesisch", "português", "portugis"], cyr: ["португальск"], zh: ["葡萄牙语", "葡萄牙語"], ja: ["ポルトガル語"], ko: ["포르투갈어"], hi: ["पुर्तगाली"], ar: ["برتغالية"], ur: ["پرتگالی"], bn: ["পর্তুগিজ"], ta: ["போர்த்துகீசிய"] },
  { key: "indonesian", latin: ["indonesio", "indonésien", "indonesisch", "indonésio", "indonesia"], cyr: ["индонезийск"], zh: ["印尼语", "印尼語"], ja: ["インドネシア語"], ko: ["인도네시아어"], hi: ["इंडोनेशियाई"], ar: ["إندونيسية"], ur: ["انڈونیشیائی"], bn: ["ইন্দোনেশীয়"], ta: ["இந்தோனேசிய"] },
  { key: "urdu", latin: ["urdu"], cyr: ["урду"], zh: ["乌尔都语", "烏爾都語"], ja: ["ウルドゥー語"], ko: ["우르두어"], hi: ["उर्दू"], ar: ["أردية", "اردية", "أوردية"], ur: ["اردو"], bn: ["উর্দু"], ta: ["உருது"] },
  { key: "bengali", latin: ["bengalí", "bengali", "bengalisch", "bengalês", "benggala"], cyr: ["бенгальск"], zh: ["孟加拉语", "孟加拉語"], ja: ["ベンガル語"], ko: ["벵골어"], hi: ["बंगाली", "बांग्ला"], ar: ["بنغالية"], ur: ["بنگالی"], bn: ["বাংলা"], ta: ["வங்காள"] },
  { key: "tamil", latin: ["tamoul", "tamil"], cyr: ["тамильск"], zh: ["泰米尔语", "泰米爾語"], ja: ["タミル語"], ko: ["타밀어"], hi: ["तमिल"], ar: ["تاميلية"], ur: ["تمل"], bn: ["তামিল"], ta: ["தமிழ"] },
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Frame per writing system: a preposition before (Latin/Cyrillic/Chinese/Arabic) or a case suffix after.
const FRAMES: Record<string, (a: string) => RegExp> = {
  // English "in X" is handled by the English rules; these frames cover the other Latin-script languages.
  latin: (a) => new RegExp(`(?:^|[\\s(])(?:en|em|auf|ins|nach|dalam|bahasa|al|ao|para|à|vers)\\s+(?:(?:el|la|le|l'|o|idioma|língua|langue|lengua|sprache|bahasa)\\s+)?${esc(a)}(?![\\p{L}])`, "giu"),
  cyr: (a) => new RegExp(`(?:(?:на|по|в)\\s+(?:\\S+\\s+)?${esc(a)}|${esc(a)}(?=\\s|[.,:;!?]|$))`, "giu"),
  zh: (a) => new RegExp(`(?:用|以|翻译成|翻譯成|翻成|译成|譯成|改成|换成|換成|写成|寫成)\\s*${esc(a)}`, "gu"),
  ja: (a) => new RegExp(`${esc(a)}(?:で|に|に翻訳|へ)`, "gu"),
  ko: (a) => new RegExp(`${esc(a)}(?:로|으로)`, "gu"),
  hi: (a) => new RegExp(`${esc(a)}\\s*(?:में|मे|भाषा में)`, "gu"),
  ar: (a) => new RegExp(`(?:باللغة\\s+ال|بال|إلى\\s+ال|الى\\s+ال)${esc(a.replace(/^ال/, ""))}`, "gu"),
  ur: (a) => new RegExp(`${esc(a)}\\s*(?:میں|زبان میں)`, "gu"),
  bn: (a) => new RegExp(`${esc(a)}(?:তে|য়|ে|\\s*ভাষায়)`, "gu"),
  ta: (a) => new RegExp(`${esc(a)}(?:த்தில்|யில்|ில்|வில்|\\s*மொழியில்)`, "gu"),
};
const COMPILED = ALIASES.flatMap((al) => (Object.keys(FRAMES) as (keyof typeof FRAMES)[]).flatMap((sys) => ((al as any)[sys] as string[] | undefined ?? []).map((a) => { const n = a.normalize("NFC"); return { key: al.key, re: FRAMES[sys](sys === "ta" ? n.replace(/்$/, "") : n) }; })));

/** Output languages the user explicitly asked for, in any of the supported languages. Most specific wins per position. */
export function explicitLanguages(text: string): { key: string; evidence: string; index: number }[] {
  const t = normalizeText(text);
  const hits: { key: string; evidence: string; index: number; len: number }[] = [];
  for (const { key, re } of COMPILED) for (const m of t.matchAll(re)) hits.push({ key, evidence: m[0].trim(), index: m.index ?? 0, len: m[0].length });
  // Drop a hit fully covered by a longer one (简体中文 beats 中文; "chino simplificado" beats "chino").
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && o.index <= h.index && o.index + o.len >= h.index + h.len));
  const seen = new Set<string>();
  return kept.sort((a, b) => a.index - b.index).filter((h) => (seen.has(h.key) ? false : (seen.add(h.key), true)));
}
