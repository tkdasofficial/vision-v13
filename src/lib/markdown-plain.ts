// Pure helpers for copy-ready replies: Markdown → clean plain text for the clipboard, and removal of
// plain-text paragraphs that merely repeat a copy-ready block (so a deliverable is shown once).

/** Converts Markdown to readable plain text: keeps paragraphs, list markers, line breaks and code text. */
export function markdownToPlainText(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) { fence = null; continue; } out.push(line); continue; }
    if (f) { fence = f[1]; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue; // horizontal rule
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue; // table separator
    let l = line
      .replace(/^(\s*)#{1,6}\s+/, "$1")
      .replace(/^(\s*)>\s?/, "$1")
      .replace(/^(\s*)[*+]\s+/, "$1- ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t, u) => (t === u ? t : `${t} (${u})`))
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n");
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t");
    out.push(l.replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const norm = (s: string) => markdownToPlainText(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const COPY_LANGS = new Set(["markdown", "md", "text", "txt", "plain", "plaintext", "prompt", ""]);

/** Drops prose paragraphs outside copy-ready fences that duplicate the fence content (≥ 40 chars). */
export function dedupeDeliverables(md: string): string {
  const blocks: { text: string; fenced: boolean; lang: string }[] = [];
  const lines = md.split("\n");
  let cur: string[] = [], fence: string | null = null, lang = "";
  const flush = (fenced: boolean) => { if (cur.length) blocks.push({ text: cur.join("\n"), fenced, lang }); cur = []; };
  for (const line of lines) {
    const f = line.match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)/);
    if (fence) { cur.push(line); if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) { flush(true); fence = null; } continue; }
    if (f) { flush(false); fence = f[1]; lang = f[2].toLowerCase(); cur.push(line); continue; }
    cur.push(line);
  }
  if (fence) flush(true); else flush(false);
  const fenced = blocks.filter((b) => b.fenced && COPY_LANGS.has(b.lang)).map((b) => norm(b.text.split("\n").slice(1, -1).join("\n")));
  if (!fenced.length) return md;
  const kept = blocks.map((b) => {
    if (b.fenced) return b.text;
    return b.text.split(/\n{2,}/).filter((p) => { const n = norm(p); return n.length < 40 || !fenced.some((f) => f.includes(n)); }).join("\n\n");
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}
