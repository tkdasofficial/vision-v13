// One heading + sentence + table row per locale configuration, used by the multilingual file-export tests.
export const SAMPLES: Record<string, { title: string; text: string; cell: string }> = {
  en: { title: "Weekly report", text: "The team shipped three features this week.", cell: "Revenue" },
  hi: { title: "साप्ताहिक रिपोर्ट", text: "टीम ने इस सप्ताह तीन नई सुविधाएँ जारी कीं।", cell: "राजस्व" },
  "zh-CN": { title: "每周报告", text: "团队本周发布了三个新功能。", cell: "收入" },
  "zh-TW": { title: "每週報告", text: "團隊本週發佈了三個新功能。", cell: "營收" },
  ru: { title: "Еженедельный отчёт", text: "Команда выпустила три новые функции на этой неделе.", cell: "Выручка" },
  es: { title: "Informe semanal", text: "El equipo lanzó tres funciones nuevas esta semana: ¡éxito!", cell: "Ingresos" },
  fr: { title: "Rapport hebdomadaire", text: "L'équipe a livré trois fonctionnalités cette semaine.", cell: "Chiffre d'affaires" },
  de: { title: "Wochenbericht", text: "Das Team hat diese Woche drei Funktionen veröffentlicht. Größe: groß.", cell: "Umsatz" },
  ja: { title: "週次レポート", text: "チームは今週、新機能を三つリリースしました。", cell: "売上" },
  ko: { title: "주간 보고서", text: "팀은 이번 주에 새로운 기능 세 개를 출시했습니다.", cell: "매출" },
  ar: { title: "التقرير الأسبوعي", text: "أطلق الفريق ثلاث ميزات جديدة هذا الأسبوع.", cell: "الإيرادات" },
  pt: { title: "Relatório semanal", text: "A equipe lançou três novas funções nesta semana.", cell: "Receita" },
  id: { title: "Laporan mingguan", text: "Tim merilis tiga fitur baru minggu ini.", cell: "Pendapatan" },
  ur: { title: "ہفتہ وار رپورٹ", text: "ٹیم نے اس ہفتے تین نئی خصوصیات جاری کیں۔", cell: "آمدنی" },
  bn: { title: "সাপ্তাহিক প্রতিবেদন", text: "দলটি এই সপ্তাহে তিনটি নতুন বৈশিষ্ট্য প্রকাশ করেছে।", cell: "আয়" },
  ta: { title: "வாராந்திர அறிக்கை", text: "குழு இந்த வாரம் மூன்று புதிய அம்சங்களை வெளியிட்டது.", cell: "வருவாய்" },
};
export const sampleMarkdown = (id: string) => { const s = SAMPLES[id]; return `# ${s.title}\n\n${s.text}\n\n- ${s.text}\n\n| ${s.cell} | 2026 |\n|---|---|\n| ${s.cell} | 42 |\n`; };
/** Mixed-direction and mixed-script paragraph: Arabic with an English product name and digits, plus Hindi and Chinese. */
export const MIXED = "# Mixed\n\nتم إطلاق VISION 2.0 في 16 أكتوبر.\n\nHindi हिन्दी, Chinese 中文, Korean 한국어 in one line.\n";
