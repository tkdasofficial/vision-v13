// Multilingual DEV set — used while building the multilingual rules (may be tuned against). The independent
// ML_HOLDOUT set lives in multilingual-holdout.ts and follows the same reference criteria.
import type { MLCase } from "./multilingual-holdout";
const L = (locale: string, rows: [string, string, string[]][]): MLCase[] => rows.map(([cat, text, expect], i) => ({ id: `d-${locale}-${i + 1}`, locale, cat, text, expect }));

export const ML_DEV: MLCase[] = [
  ...L("en", [
    ["lang", "Write the answer in Simplified Chinese.", ["lang:chinese-simplified"]],
    ["lang", "Explain DNS in Indonesian.", ["lang:indonesian"]],
    ["mixed", "Write 2 paragraphs in English with the title in Japanese.", ["count:2:paragraph", "lang:english"]],
  ]),
  ...L("hi", [
    ["count", "क्रिकेट पर 10 प्रश्न लिखो।", ["count:10:question", "lang:hindi~"]],
    ["words", "100 शब्दों से कम में एक कहानी लिखो।", ["deliverable:story", "words:-100:total", "lang:hindi~"]],
    ["mixed", "Mujhe 3 tips do, Hindi mein, without emojis", ["count:3:tip", "lang:hindi", "exclude:emojis"]],
  ]),
  ...L("zh-CN", [
    ["count", "给我3个周末活动的想法。", ["count:3:idea", "lang:chinese-simplified~"]],
    ["lang", "请用日语回答。", ["lang:japanese"]],
    ["exclude", "写一个简短的介绍，不要提到价格。", ["length:short", "exclude:价格", "lang:chinese-simplified~"]],
  ]),
  ...L("zh-TW", [
    ["count", "請給我3個學習的建議。", ["count:3:tip", "lang:chinese-traditional~"]],
    ["format", "用表格整理這些資料，只返回表格。", ["format:table", "no-commentary", "lang:chinese-traditional~"]],
    ["lang", "請用英文寫一封郵件。", ["deliverable:email", "lang:english"]],
  ]),
  ...L("ru", [
    ["count", "Придумай 4 вопроса для интервью.", ["count:4:question", "lang:russian~"]],
    ["words", "Напиши эссе не менее 300 слов.", ["deliverable:essay", "words:300-:total", "lang:russian~"]],
    ["lang", "Переведи на немецкий язык.", ["lang:german"]],
  ]),
  ...L("es", [
    ["count", "Dame 3 razones para viajar.", ["count:3:reason", "lang:spanish~"]],
    ["format", "Haz una lista con viñetas de frutas.", ["format:bullets", "lang:spanish~"]],
    ["words", "Escribe un informe de al menos 200 palabras.", ["deliverable:report", "words:200-:total", "lang:spanish~"]],
  ]),
  ...L("fr", [
    ["count", "Propose 3 exemples de phrases au passé.", ["count:3:example", "lang:french~"]],
    ["lang", "Écris la réponse en anglais.", ["lang:english"]],
    ["words", "Écris un essai d'au moins 250 mots.", ["deliverable:essay", "words:250-:total", "lang:french~"]],
  ]),
  ...L("de", [
    ["count", "Nenne 5 Gründe für Sport.", ["count:5:reason", "lang:german~"]],
    ["format", "Gib mir eine Aufzählung mit Aufzählungspunkten.", ["format:bullets", "lang:german~"]],
    ["exclude", "Schreibe einen Bericht ohne Fachbegriffe.", ["deliverable:report", "exclude:fachbegriffe", "lang:german~"]],
  ]),
  ...L("ja", [
    ["count", "質問を4つ作ってください。", ["count:4:question", "lang:japanese~"]],
    ["chars", "100文字以内で自己紹介を書いて。", ["chars:100", "lang:japanese~"]],
    ["lang", "中国語で書いてください。", ["lang:chinese"]],
  ]),
  ...L("ko", [
    ["count", "질문 4개를 만들어 줘.", ["count:4:question", "lang:korean~"]],
    ["words", "50단어 이내로 요약해 줘.", ["deliverable:summary", "words:-50:total", "lang:korean~"]],
    ["lang", "중국어로 번역해 줘.", ["lang:chinese"]],
  ]),
  ...L("ar", [
    ["count", "اكتب 3 أسئلة عن التاريخ.", ["count:3:question", "lang:arabic~"]],
    ["lang", "أجب بالفرنسية من فضلك.", ["lang:french"]],
    ["format", "اعرض البيانات في جدول.", ["format:table", "lang:arabic~"]],
  ]),
  ...L("pt", [
    ["count", "Dê 3 exemplos de verbos.", ["count:3:example", "lang:portuguese~"]],
    ["lang", "Escreva em francês, por favor.", ["lang:french"]],
    ["exclude", "Faça um resumo sem números.", ["deliverable:summary", "exclude:números", "lang:portuguese~"]],
  ]),
  ...L("id", [
    ["count", "Berikan 4 pertanyaan tentang sejarah.", ["count:4:question", "lang:indonesian~"]],
    ["lang", "Tolong jawab dalam bahasa Jepang.", ["lang:japanese"]],
    ["format", "Buat daftar bernomor berisi buah-buahan.", ["format:numbered", "lang:indonesian~"]],
  ]),
  ...L("ur", [
    ["count", "تاریخ کے بارے میں 4 سوالات لکھیں۔", ["count:4:question", "lang:urdu~"]],
    ["lang", "عربی میں جواب دیں۔", ["lang:arabic"]],
    ["tone", "ایک دوستانہ پیغام لکھیں۔", ["tone:friendly", "lang:urdu~"]],
  ]),
  ...L("bn", [
    ["count", "ইতিহাস নিয়ে ৪টি প্রশ্ন লেখো।", ["count:4:question", "lang:bengali~"]],
    ["lang", "উর্দুতে লেখো।", ["lang:urdu"]],
    ["format", "শুধু একটি টেবিল দাও।", ["format:table", "no-commentary", "lang:bengali~"]],
  ]),
  ...L("ta", [
    ["count", "வரலாறு பற்றி 4 கேள்விகள் எழுதுங்கள்.", ["count:4:question", "lang:tamil~"]],
    ["lang", "உருதுவில் எழுதுங்கள்.", ["lang:urdu"]],
    ["tone", "ஒரு நட்பான செய்தி எழுதுங்கள்.", ["tone:friendly", "lang:tamil~"]],
  ]),
];
