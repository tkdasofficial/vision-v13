// Multilingual HOLDOUT 2 — written after the first holdout was measured and its results seen, so the first
// holdout can no longer be called untouched. This set was written before being run even once and is never tuned
// against. Same reference criteria as multilingual-holdout.ts. 5 cases per locale configuration.
import type { MLCase } from "./multilingual-holdout";
const L = (locale: string, rows: [string, string, string[]][]): MLCase[] => rows.map(([cat, text, expect], i) => ({ id: `x-${locale}-${i + 1}`, locale, cat, text, expect }));

export const ML_HOLDOUT2: MLCase[] = [
  ...L("en", [
    ["lang", "Answer in Traditional Chinese please.", ["lang:chinese-traditional"]],
    ["count", "Suggest 8 names for a bakery, numbered.", ["count:8:name", "format:numbered"]],
    ["exclude", "Write a casual tweet without hashtags.", ["deliverable:tweet", "tone:casual", "exclude:hashtags"]],
    ["lang", "Explain gravity in Bengali, briefly.", ["lang:bengali", "length:short"]],
    ["words", "Write at least 500 words on the history of tea.", ["words:500-:total"]],
  ]),
  ...L("hi", [
    ["count", "विज्ञान पर 7 प्रश्न बनाइए।", ["count:7:question", "lang:hindi~"]],
    ["lang", "यह कहानी उर्दू में लिखिए।", ["deliverable:story", "lang:urdu"]],
    ["words", "कम से कम 200 शब्दों का निबंध लिखो।", ["deliverable:essay", "words:200-:total", "lang:hindi~"]],
    ["format", "फलों की एक तालिका दो।", ["format:table", "lang:hindi~"]],
    ["tone", "एक मज़ेदार कविता लिखो।", ["deliverable:poem", "tone:humorous", "lang:hindi~"]],
  ]),
  ...L("zh-CN", [
    ["count", "给我4个理由。", ["count:4:reason", "lang:chinese-simplified~"]],
    ["chars", "写一篇作文，至少500字。", ["deliverable:essay", "chars:500-", "lang:chinese-simplified~"]],
    ["lang", "请用韩语写一封信。", ["deliverable:letter", "lang:korean"]],
    ["format", "用项目符号列出要点。", ["format:bullets", "lang:chinese-simplified~"]],
    ["tone", "写一个幽默的故事。", ["deliverable:story", "tone:humorous", "lang:chinese-simplified~"]],
  ]),
  ...L("zh-TW", [
    ["count", "請列出6個步驟。", ["count:6:step", "lang:chinese-traditional~"]],
    ["lang", "請用英文寫這份報告。", ["deliverable:report", "lang:english"]],
    ["exclude", "寫一篇短文，不要使用專業術語。", ["length:short", "exclude:專業術語", "lang:chinese-traditional~"]],
    ["format", "請用編號列表回答。", ["format:numbered", "lang:chinese-traditional~"]],
    ["deliverable", "幫我總結這段對話。", ["deliverable:summary", "lang:chinese-traditional~"]],
  ]),
  ...L("ru", [
    ["count", "Приведи 5 примеров метафор.", ["count:5:example", "lang:russian~"]],
    ["lang", "Напиши письмо по-французски.", ["deliverable:letter", "lang:french"]],
    ["exclude", "Объясни без формул.", ["exclude:формул", "lang:russian~"]],
    ["format", "Сделай маркированный список покупок.", ["format:bullets", "lang:russian~"]],
    ["tone", "Напиши дружелюбное сообщение коллеге.", ["tone:friendly", "lang:russian~"]],
  ]),
  ...L("es", [
    ["count", "Escribe 6 preguntas sobre historia.", ["count:6:question", "lang:spanish~"]],
    ["lang", "Contesta en japonés, por favor.", ["lang:japanese"]],
    ["exclude", "Hazme un resumen sin tecnicismos.", ["deliverable:summary", "exclude:tecnicismos", "lang:spanish~"]],
    ["chars", "Escribe un mensaje de máximo 160 caracteres.", ["chars:160", "lang:spanish~"]],
    ["tone", "Escribe un chiste divertido para niños.", ["tone:humorous", "lang:spanish~"]],
  ]),
  ...L("fr", [
    ["count", "Donne 3 raisons d'apprendre le piano.", ["count:3:reason", "lang:french~"]],
    ["lang", "Écris ce texte en espagnol.", ["lang:spanish"]],
    ["words", "Écris un rapport d'au moins 300 mots.", ["deliverable:report", "words:300-:total", "lang:french~"]],
    ["exclude", "Fais un résumé sans chiffres.", ["deliverable:summary", "exclude:chiffres", "lang:french~"]],
    ["tone", "Écris une lettre formelle à la mairie.", ["deliverable:letter", "tone:formal", "lang:french~"]],
  ]),
  ...L("de", [
    ["count", "Schreibe 5 Fragen zur Geschichte.", ["count:5:question", "lang:german~"]],
    ["lang", "Übersetze das bitte ins Spanische.", ["lang:spanish"]],
    ["words", "Schreibe einen Aufsatz mit mindestens 400 Wörtern.", ["deliverable:essay", "words:400-:total", "lang:german~"]],
    ["exclude", "Erkläre das ohne Fachjargon.", ["exclude:fachjargon", "lang:german~"]],
    ["tone", "Schreibe eine lustige Geschichte für Kinder.", ["deliverable:story", "tone:humorous", "lang:german~"]],
  ]),
  ...L("ja", [
    ["count", "理由を3つ挙げてください。", ["count:3:reason", "lang:japanese~"]],
    ["lang", "スペイン語で書いてください。", ["lang:spanish"]],
    ["exclude", "専門用語なしで説明してください。", ["exclude:専門用語", "lang:japanese~"]],
    ["format", "箇条書きでまとめてください。", ["format:bullets", "lang:japanese~"]],
    ["deliverable", "短い物語を書いてください。", ["deliverable:story", "length:short", "lang:japanese~"]],
  ]),
  ...L("ko", [
    ["count", "이유 3가지를 알려줘.", ["count:3:reason", "lang:korean~"]],
    ["lang", "프랑스어로 번역해 줘.", ["lang:french"]],
    ["exclude", "전문 용어 없이 설명해 줘.", ["exclude:용어", "lang:korean~"]],
    ["deliverable", "재미있는 이야기를 써 줘.", ["deliverable:story", "tone:humorous", "lang:korean~"]],
    ["words", "300단어 이상의 에세이를 써 줘.", ["deliverable:essay", "words:300-:total", "lang:korean~"]],
  ]),
  ...L("ar", [
    ["count", "اذكر 6 أسباب لممارسة الرياضة.", ["count:6:reason", "lang:arabic~"]],
    ["lang", "اكتب الرد بالإسبانية.", ["lang:spanish"]],
    ["words", "اكتب مقالاً لا يقل عن 300 كلمة.", ["deliverable:essay", "words:300-:total", "lang:arabic~"]],
    ["tone", "اكتب رسالة ودية لصديقي.", ["deliverable:letter", "tone:friendly", "lang:arabic~"]],
    ["format", "ضع النتائج في جدول.", ["format:table", "lang:arabic~"]],
  ]),
  ...L("pt", [
    ["count", "Escreva 5 perguntas sobre ciência.", ["count:5:question", "lang:portuguese~"]],
    ["lang", "Traduza para o alemão.", ["lang:german"]],
    ["words", "Escreva um relatório de pelo menos 250 palavras.", ["deliverable:report", "words:250-:total", "lang:portuguese~"]],
    ["format", "Faça uma lista com marcadores.", ["format:bullets", "lang:portuguese~"]],
    ["tone", "Escreva uma mensagem amigável para um cliente.", ["tone:friendly", "lang:portuguese~"]],
  ]),
  ...L("id", [
    ["count", "Tulis 6 alasan untuk belajar.", ["count:6:reason", "lang:indonesian~"]],
    ["lang", "Tulis surat ini dalam bahasa Arab.", ["deliverable:letter", "lang:arabic"]],
    ["words", "Tulis laporan minimal 300 kata.", ["deliverable:report", "words:300-:total", "lang:indonesian~"]],
    ["exclude", "Jelaskan tanpa istilah teknis.", ["exclude:istilah teknis", "lang:indonesian~"]],
    ["tone", "Buat cerita lucu untuk anak-anak.", ["deliverable:story", "tone:humorous", "lang:indonesian~"]],
  ]),
  ...L("ur", [
    ["count", "سائنس پر 6 سوالات بنائیں۔", ["count:6:question", "lang:urdu~"]],
    ["lang", "یہ خط انگریزی میں لکھیں۔", ["deliverable:letter", "lang:english"]],
    ["words", "کم از کم 200 الفاظ کا مضمون لکھیں۔", ["deliverable:essay", "words:200-:total", "lang:urdu~"]],
    ["tone", "ایک مزاحیہ کہانی لکھیں۔", ["deliverable:story", "tone:humorous", "lang:urdu~"]],
    ["format", "نتائج کو جدول میں دکھائیں۔", ["format:table", "lang:urdu~"]],
  ]),
  ...L("bn", [
    ["count", "বিজ্ঞান নিয়ে ৬টি প্রশ্ন লেখো।", ["count:6:question", "lang:bengali~"]],
    ["lang", "এই চিঠিটি ইংরেজিতে লেখো।", ["deliverable:letter", "lang:english"]],
    ["words", "অন্তত 200 শব্দের একটি প্রবন্ধ লেখো।", ["deliverable:essay", "words:200-:total", "lang:bengali~"]],
    ["tone", "একটি মজার গল্প লেখো।", ["deliverable:story", "tone:humorous", "lang:bengali~"]],
    ["format", "ফলাফল একটি টেবিলে দাও।", ["format:table", "lang:bengali~"]],
  ]),
  ...L("ta", [
    ["count", "அறிவியல் பற்றி 6 கேள்விகள் எழுதுங்கள்.", ["count:6:question", "lang:tamil~"]],
    ["lang", "இந்தக் கடிதத்தை ஆங்கிலத்தில் எழுதுங்கள்.", ["deliverable:letter", "lang:english"]],
    ["words", "குறைந்தது 200 வார்த்தைகளில் ஒரு கட்டுரை எழுதுங்கள்.", ["deliverable:essay", "words:200-:total", "lang:tamil~"]],
    ["tone", "ஒரு நகைச்சுவை கதை எழுதுங்கள்.", ["deliverable:story", "tone:humorous", "lang:tamil~"]],
    ["format", "முடிவுகளை அட்டவணையில் காட்டுங்கள்.", ["format:table", "lang:tamil~"]],
  ]),
];
