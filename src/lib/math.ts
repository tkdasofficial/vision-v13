/** Normalises the maths delimiters models emit so remark-math renders them, without touching code.
 *  - \( … \) → $…$, \[ … \] → $$…$$
 *  - ```math / ```latex / ```tex fences → $$ display blocks
 *  - currency like "$12,597.12" is escaped so it never becomes a formula. */
export function normalizeMath(src: string): string {
  const out: string[] = [];
  const parts = src.split(/(^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$)/m);
  for (const part of parts) {
    const fence = /^[ \t]*(```|~~~)[ \t]*(math|latex|tex|katex)[ \t]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*$/i.exec(part);
    if (fence) { out.push(`$$\n${fence[3].trim()}\n$$`); continue; }
    if (/^[ \t]*(?:```|~~~)/.test(part)) { out.push(part); continue; }
    // Keep inline code untouched.
    out.push(part.split(/(`+[^`\n]*`+)/).map((s, i) => (i % 2 ? s : prose(s))).join(""));
  }
  return out.join("");
}

function prose(s: string): string {
  return s
    // A \[ … \] block keeps its line's indentation so it stays inside list items.
    .replace(/^([ \t]*)\\\[([\s\S]+?)\\\][ \t]*$/gm, (_, ind, m) => `${ind}$$\n${ind}${m.trim().replace(/\n[ \t]*/g, `\n${ind}`)}\n${ind}$$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`)
    // "$12,597.12" / "$5 million": digits then a non-maths character → literal dollar.
    .replace(/(^|[^\\$])\$(?=\d[\d,]*(?:\.\d+)?(?:[\s.,;:!?)\]]|$|[kKmMbB]\b))/g, "$1\\$");
}
