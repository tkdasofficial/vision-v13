// Requirement-understanding benchmark: baseline (pre-upgrade code) vs the structured spec, same cases + scoring.
// Run with REQ_BENCH_REPORT=1 to print the full per-case report.
import { describe, it, expect } from "vitest";
import { DEV, HOLDOUT, HOLDOUT2, type BenchCase } from "./fixtures/requirement-benchmark";
import { scoreCase, summarize } from "@/lib/ai/requirement-score";
import { baselineAtoms } from "@/lib/ai/requirement-baseline";

let specAtoms: ((t: string, h?: any[]) => string[]) | null = null;
try { specAtoms = (await import("@/lib/ai/requirement-spec")).specAtoms; } catch { specAtoms = null; }

const run = (cases: BenchCase[], f: (t: string, h?: any[]) => string[]) => cases.map((c) => scoreCase(c, f(c.text, c.history ?? [])));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function report(label: string, rows: ReturnType<typeof run>) {
  const s = summarize(rows);
  if (process.env.REQ_BENCH_REPORT) {
    console.log(`\n== ${label}: ${s.cases} cases | exact ${pct(s.exact)} | P ${pct(s.precision)} R ${pct(s.recall)} F1 ${pct(s.f1)} | critical omission ${pct(s.critOmission)} | contradiction ${pct(s.contradiction)}`);
    console.log("   by category:", Object.entries(s.byCat).map(([k, v]) => `${k} ${v.exact}/${v.n}`).join(", "));
    for (const r of rows.filter((r) => !r.exact)) console.log(`   ${r.id} missing=${JSON.stringify(r.missing)} extra=${JSON.stringify(r.extra)}`);
  }
  return s;
}

describe("requirement-understanding benchmark", () => {
  it("has at least 50 dev cases plus a held-out set", () => {
    expect(DEV.length).toBeGreaterThanOrEqual(50);
    expect(new Set([...DEV, ...HOLDOUT].map((c) => c.id)).size).toBe(DEV.length + HOLDOUT.length);
    expect(new Set([...DEV, ...HOLDOUT, ...HOLDOUT2].map((c) => c.id)).size).toBe(DEV.length + HOLDOUT.length + HOLDOUT2.length);
  });
  it("baseline report", () => { report("BASELINE dev", run(DEV, baselineAtoms)); report("BASELINE holdout", run(HOLDOUT, baselineAtoms)); report("BASELINE holdout2", run(HOLDOUT2, baselineAtoms)); });
  it("upgraded spec beats the baseline on both sets with no new critical omissions", () => {
    expect(specAtoms).toBeTruthy();
    for (const [name, set] of [["dev", DEV], ["holdout", HOLDOUT], ["holdout2", HOLDOUT2]] as const) {
      const b = report(`BASELINE ${name}`, run(set, baselineAtoms)), s = report(`SPEC ${name}`, run(set, specAtoms!));
      expect(s.f1).toBeGreaterThan(b.f1);
      expect(s.critOmission).toBeLessThanOrEqual(b.critOmission);
    }
    const dev = summarize(run(DEV, specAtoms!));
    expect(dev.f1).toBeGreaterThanOrEqual(0.95); // regression floor for the measured dev score
  });
});
