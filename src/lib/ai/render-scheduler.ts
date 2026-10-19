// Presentation-only reveal schedule for a finished, validated answer. Pure; never affects generation.

export type RevealOptions = { wordsPerSecond?: number; minStepMs?: number; maxTotalMs?: number; codeLinesPerUnit?: number };
export const DEFAULT_REVEAL: Required<RevealOptions> = { wordsPerSecond: 42, minStepMs: 90, maxTotalMs: 9000, codeLinesPerUnit: 12 };

/** Splits Markdown into logical units (heading, paragraph, list item, table row, code chunk) whose ends are safe cut points. */
export function splitUnits(md: string, codeLinesPerUnit = DEFAULT_REVEAL.codeLinesPerUnit): string[] {
  const lines = md.split("\n");
  const units: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) { units.push(cur.join("\n")); cur = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*(```+|~~~+)/);
    if (fence) {
      flush();
      const block = [l]; let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) block.push(lines[j++]);
      if (j < lines.length) block.push(lines[j]);
      i = j;
      // Code is revealed in stable line chunks; each prefix stays a valid (auto-closed) block.
      for (let k = 0; k < block.length; k += codeLinesPerUnit) units.push(block.slice(k, k + codeLinesPerUnit).join("\n"));
      continue;
    }
    if (!l.trim()) { cur.push(l); flush(); continue; }
    if (/^\s*#{1,6}\s/.test(l)) { flush(); units.push(l); continue; }
    if (/^\s*\|/.test(l)) {
      // Header + separator row stay together so the table structure is never broken.
      if (!cur.length || !/^\s*\|/.test(cur[0])) flush();
      cur.push(l);
      const isHeader = /^\s*\|/.test(lines[i + 1] ?? "") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "");
      if (!isHeader && !/^\s*\|?\s*:?-{2,}/.test(l)) flush();
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(l)) { flush(); cur.push(l); continue; }
    cur.push(l);
  }
  flush();
  return units;
}

const words = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Cumulative character offsets to reveal, batched so updates stay few and the total wait stays bounded. */
export function revealPlan(md: string, opts: RevealOptions = {}): { upto: number; delayMs: number }[] {
  const o = { ...DEFAULT_REVEAL, ...opts };
  const units = splitUnits(md, o.codeLinesPerUnit);
  const raw = units.map((u) => Math.max(40, (words(u) / o.wordsPerSecond) * 1000 + (/[.!?:]\s*$/.test(u.trim()) ? 60 : 0)));
  const total = raw.reduce((a, b) => a + b, 0);
  const scale = total > o.maxTotalMs ? o.maxTotalMs / total : 1;
  const steps: { upto: number; delayMs: number }[] = [];
  let offset = 0, pending = 0;
  units.forEach((u, i) => {
    offset += u.length + (i < units.length - 1 ? 1 : 0);
    pending += raw[i] * scale;
    if (pending >= o.minStepMs || i === units.length - 1) { steps.push({ upto: Math.min(offset, md.length), delayMs: Math.round(pending) }); pending = 0; }
  });
  if (steps.length) steps[steps.length - 1].upto = md.length;
  return steps;
}
