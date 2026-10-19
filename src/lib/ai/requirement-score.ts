// Scoring for the requirement-understanding benchmark. Pure, tested. Metric definitions:
//  - exact match: predicted atom set == reference atom set (per case; denominator = cases)
//  - precision: correct predicted atoms / all predicted atoms (micro, across cases)
//  - recall: correct predicted atoms / all reference atoms (micro)
//  - F1: harmonic mean of micro precision and recall
//  - critical omission rate: reference atoms of critical kinds (count, words, chars, format, lang, script,
//    exclude, verbatim, preserve, ref, conflict, ambiguous, or listed in case.critical) that were not
//    predicted / all critical reference atoms
//  - contradiction rate: predicted atoms that share a key with a reference atom but have a different value
//    (e.g. count:5:tip vs count:7:tip, or explicit vs ~inferred) / all predicted atoms
export type Scored = { id: string; cat: string; exact: boolean; tp: number; fp: number; fn: number; critTotal: number; critMissed: number; contradictions: number; missing: string[]; extra: string[] };

const CRIT = /^(count|words|chars|format|lang|script|exclude|verbatim|preserve|ref|conflict|ambiguous):/;
/** Key identifying "the same requirement slot" so different values count as a contradiction. */
export function atomKey(a: string): string {
  const base = a.replace(/[?~]$/, "");
  const [k, v] = base.split(":");
  if (["count", "words", "chars", "length", "ref", "durations", "duration-total", "order"].includes(k)) return k;
  if (k === "script") return `script:${v}`;
  return base; // include/exclude/format/tone/...: only marker differences contradict
}

export function scoreCase(c: { id: string; cat: string; expect: string[]; critical?: string[] }, predicted: string[]): Scored {
  const exp = new Set(c.expect), pred = new Set(predicted);
  const tp = [...pred].filter((a) => exp.has(a)).length;
  const missing = [...exp].filter((a) => !pred.has(a)), extra = [...pred].filter((a) => !exp.has(a));
  const crit = [...exp].filter((a) => CRIT.test(a) || c.critical?.includes(a));
  const expKeys = new Map([...exp].map((a) => [atomKey(a), a]));
  const contradictions = extra.filter((a) => expKeys.has(atomKey(a))).length;
  return { id: c.id, cat: c.cat, exact: missing.length === 0 && extra.length === 0, tp, fp: extra.length, fn: missing.length, critTotal: crit.length, critMissed: crit.filter((a) => !pred.has(a)).length, contradictions, missing, extra };
}

export function summarize(rows: Scored[]) {
  const sum = (f: (r: Scored) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tp = sum((r) => r.tp), fp = sum((r) => r.fp), fn = sum((r) => r.fn);
  const p = tp + fp ? tp / (tp + fp) : 1, rc = tp + fn ? tp / (tp + fn) : 1;
  const byCat: Record<string, { n: number; exact: number }> = {};
  for (const r of rows) { const b = (byCat[r.cat] ??= { n: 0, exact: 0 }); b.n++; if (r.exact) b.exact++; }
  return {
    cases: rows.length, exact: sum((r) => (r.exact ? 1 : 0)) / rows.length, precision: p, recall: rc, f1: p + rc ? (2 * p * rc) / (p + rc) : 0,
    critOmission: sum((r) => r.critMissed) / Math.max(1, sum((r) => r.critTotal)), contradiction: sum((r) => r.contradictions) / Math.max(1, tp + fp), byCat,
  };
}
