// Multilingual requirement-understanding benchmark: frozen pre-multilingual engine vs current engine, per locale.
// ML_HOLDOUT was measured once before any fix (first-run: exact 88.1%, F1 95.3%, critical omission 8.5%);
// later fixes were driven only by ML_DEV failures. ML_HOLDOUT2 was written after that and is never tuned against. Run with REQ_BENCH_REPORT=1 to print per-locale tables.
import { describe, it, expect } from "vitest";
import { ML_HOLDOUT } from "./fixtures/multilingual-holdout";
import { ML_DEV } from "./fixtures/multilingual-dev";
import { ML_HOLDOUT2 } from "./fixtures/multilingual-holdout2";
import { scoreCase, summarize } from "@/lib/ai/requirement-score";
import { specAtoms as preAtoms } from "./fixtures/spec-pre-multilingual";
import { specAtoms } from "@/lib/ai/requirement-spec";
import { LOCALES } from "@/lib/i18n/locales";

type C = (typeof ML_HOLDOUT)[number];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const score = (cases: C[], f: (t: string) => string[]) => cases.map((c) => scoreCase(c, f(c.text)));
function byLocale(cases: C[], f: (t: string) => string[]) {
  const out: Record<string, ReturnType<typeof summarize>> = {};
  for (const l of LOCALES) { const sub = cases.filter((c) => c.locale === l.id); if (sub.length) out[l.id] = summarize(score(sub, f)); }
  return out;
}
function print(label: string, cases: C[]) {
  if (!process.env.REQ_BENCH_REPORT) return;
  const pre = byLocale(cases, preAtoms), now = byLocale(cases, specAtoms);
  console.log(`\n== ${label} (${cases.length} cases) — locale | before exact/F1/miss-crit/contra | after exact/F1/miss-crit/contra`);
  for (const k of Object.keys(now)) console.log(`${k.padEnd(6)} | ${pct(pre[k].exact)} ${pct(pre[k].f1)} ${pct(pre[k].critOmission)} ${pct(pre[k].contradiction)} | ${pct(now[k].exact)} ${pct(now[k].f1)} ${pct(now[k].critOmission)} ${pct(now[k].contradiction)}`);
  const a = summarize(score(cases, preAtoms)), b = summarize(score(cases, specAtoms));
  console.log(`ALL    | ${pct(a.exact)} P${pct(a.precision)} R${pct(a.recall)} F1 ${pct(a.f1)} ${pct(a.critOmission)} ${pct(a.contradiction)} | ${pct(b.exact)} P${pct(b.precision)} R${pct(b.recall)} F1 ${pct(b.f1)} ${pct(b.critOmission)} ${pct(b.contradiction)}`);
  for (const r of score(cases, specAtoms).filter((r) => !r.exact)) console.log(`   ${r.id} missing=${JSON.stringify(r.missing)} extra=${JSON.stringify(r.extra)}`);
}

describe("multilingual requirement benchmark", () => {
  it("covers all 16 locale configurations with ≥10 holdout cases each, ids unique and disjoint from dev", () => {
    expect(LOCALES.length).toBe(16);
    for (const l of LOCALES) expect(ML_HOLDOUT.filter((c) => c.locale === l.id).length).toBeGreaterThanOrEqual(10);
    const ids = [...ML_HOLDOUT, ...ML_HOLDOUT2, ...ML_DEV].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = new Set(ML_DEV.map((c) => c.text));
    expect(ML_HOLDOUT.some((c) => texts.has(c.text))).toBe(false);
  });
  it("reports dev and holdout", () => { print("DEV", ML_DEV); print("HOLDOUT", ML_HOLDOUT); print("HOLDOUT2", ML_HOLDOUT2); });
  it("current engine beats the frozen pre-multilingual engine on the holdout, with fewer critical omissions", () => {
    for (const set of [ML_HOLDOUT, ML_HOLDOUT2]) {
      const a = summarize(score(set, preAtoms)), b = summarize(score(set, specAtoms));
      expect(b.f1).toBeGreaterThan(a.f1);
      expect(b.critOmission).toBeLessThan(a.critOmission);
    }
  });
});
