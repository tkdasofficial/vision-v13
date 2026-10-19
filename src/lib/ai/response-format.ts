/** Conservative fallback for clearly labelled reusable prose; never infer from keywords in a paragraph. */
const reusable = /^(?:(?:full |complete )?story(?: prose)?|(?:visual |image |video |system )?prompt(?:\s+\d+)?|dialogue(?:s)?|chart (?:specification|data|description))\s*:?(?:\s*[—–-]\s*.+)?$/i;

function label(line: string): { title: string; level: number } | null {
  const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (heading) return { title: heading[2], level: heading[1].length };
  const bold = /^\s*\*\*(.+?)\*\*\s*:?[ \t]*$/.exec(line);
  return bold ? { title: bold[1], level: 6 } : null;
}

/** Existing fences, ordinary discussion and independently copyable tables remain untouched. */
export function autoCopySections(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      output.push(lines[i]);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; output.push(lines[i]); continue; }
    const section = label(lines[i]);
    output.push(lines[i]);
    if (!section || !reusable.test(section.title)) continue;
    let end = i + 1;
    while (end < lines.length) {
      const next = label(lines[end]);
      if (next && (next.level <= section.level || reusable.test(next.title))) break;
      // A fenced snippet or table is already independently copyable; do not nest it.
      if (/^\s{0,3}(?:`{3,}|~{3,})/.test(lines[end]) || /^\s*\|/.test(lines[end])) break;
      end++;
    }
    const body = lines.slice(i + 1, end).join("\n").trim();
    if (!body) continue;
    const longest = Math.max(3, ...Array.from(body.matchAll(/`+/g), (m) => m[0].length));
    const delimiter = "`".repeat(longest + 1);
    output.push(`\n${delimiter}markdown\n${body}\n${delimiter}\n`);
    i = end - 1;
  }
  return output.join("\n");
}