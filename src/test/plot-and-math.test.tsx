import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MarkdownReply from "@/components/chat/markdown-reply";
import { checkPlot, checkObjectReuse, checkCameraDirection, checkCharacterState, checkTransitions } from "@/lib/ai/deep/plot";
import { normalizeMath } from "@/lib/math";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scene = (n: number, body: string) => `Scene ${n}: ${body}`;
const filler = (n: number) => scene(n, `Bolt, the small silver robot with a blue visor, walks through the quiet city. Camera: steady wide shot.`);

function story(over: Record<number, string>) {
  return Array.from({ length: 20 }, (_, i) => (over[i + 1] ? scene(i + 1, over[i + 1]) : filler(i + 1))).join("\n\n");
}

describe("whole-story plot validator", () => {
  it("detects the Bolt energy-core reuse between scenes 14 and 18", () => {
    const text = story({
      14: "Bolt inserts the glowing energy core into the tower's reactor, and the city lights flare back on. Camera: slow push-in.",
      18: "Bolt holds the energy core high above his head as the storm closes in. Camera: low angle.",
    });
    const issues = checkPlot(text, "scene");
    const reuse = issues.find((i) => i.code === "plot_object_reuse");
    expect(reuse?.items).toEqual([14, 18]);
    expect(reuse?.message).toMatch(/energy core/);
  });

  it("accepts the energy core when its recovery is shown first", () => {
    const text = story({
      14: "Bolt inserts the energy core into the reactor. Camera: push-in.",
      17: "Bolt pulls the energy core back out of the cooling reactor. Camera: close-up.",
      18: "Bolt holds the energy core high. Camera: low angle.",
    });
    expect(checkPlot(text, "scene").filter((i) => i.code === "plot_object_reuse")).toEqual([]);
  });

  it("detects the scene 11 camera descending while Bolt climbs", () => {
    const text = story({ 11: "Bolt climbs the rusted ladder toward the rooftop antenna. Camera: the camera descends slowly past him." });
    const cam = checkCameraDirection([{ num: 11, body: "Bolt climbs the rusted ladder toward the rooftop antenna. Camera: the camera descends slowly past him." }]);
    expect(cam[0]?.items).toEqual([11]);
    expect(checkPlot(text, "scene").some((i) => i.code === "plot_camera_direction" && i.items?.[0] === 11)).toBe(true);
  });

  it("accepts a camera that follows the climb", () => {
    expect(checkCameraDirection([{ num: 11, body: "Bolt climbs the ladder. Camera: tilts up, following him to the roof." }])).toEqual([]);
    expect(checkCameraDirection([{ num: 11, body: "Bolt climbs down into the tunnel. Camera: tilts down after him." }])).toEqual([]);
  });

  it("detects a disabled character acting without recovery, and a lost limb reused", () => {
    expect(checkCharacterState([{ num: 5, body: "The drone hits Bolt and he powers down." }, { num: 6, body: "Bolt runs across the bridge." }])[0]?.items).toEqual([5, 6]);
    expect(checkCharacterState([{ num: 5, body: "Bolt powers down." }, { num: 6, body: "Bolt reboots with a whir and runs across the bridge." }])).toEqual([]);
    expect(checkCharacterState([{ num: 3, body: "The crusher snaps Bolt's left arm." }, { num: 4, body: "Bolt raises his left arm to wave." }])[0]?.items).toEqual([3, 4]);
  });

  it("detects a location jump with no causal transition", () => {
    const s = [{ num: 1, body: "Location: rooftop garden\nBolt waters a flower." }, { num: 2, body: "Location: underground subway\nBolt sorts bolts quietly." }];
    expect(checkTransitions(s)[0]?.items).toEqual([1, 2]);
    s[1].body = "Location: underground subway\nBolt arrives by the service lift and sorts bolts.";
    expect(checkTransitions(s)).toEqual([]);
  });

  it("passes a consistent story and ignores non-story lists", () => {
    expect(checkPlot(story({}), "scene")).toEqual([]);
    expect(checkObjectReuse([{ num: 1, body: "Insert the key card." }])).toEqual([]);
  });
});

describe("maths rendering", () => {
  it("renders inline and display equations with fractions, exponents and subscripts", () => {
    const md = "Interest: $A = P\\left(1 + \\frac{r}{n}\\right)^{nt}$ where $x_1$ is first.\n\n$$\nE = mc^2\n$$";
    const { container } = render(<MarkdownReply>{md}</MarkdownReply>);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.querySelector(".mfrac")).toBeTruthy();
    expect(container.querySelector(".msupsub")).toBeTruthy();
    expect(container.textContent).not.toContain("$$");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("converts \\( \\) and \\[ \\] delimiters and math fences instead of showing source", () => {
    const md = "Area is \\(\\pi r^2\\).\n\n\\[ a^2 + b^2 = c^2 \\]\n\n```latex\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n```";
    const { container } = render(<MarkdownReply>{md}</MarkdownReply>);
    expect(container.querySelectorAll(".katex-display").length).toBe(2);
    expect(container.textContent).not.toMatch(/\\\(|\\\[/);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("keeps currency, code blocks, tables and Note boxes intact", () => {
    const md = "You get $12,597.12 after 5 years and $5 bonus.\n\n```js\nconst price = \"$5\";\n```\n\n| Year | Value |\n|---|---|\n| 1 | $10,500 |\n\n> [!NOTE]\n> Rates vary with $r$.";
    const { container, getByRole } = render(<MarkdownReply>{md}</MarkdownReply>);
    expect(container.textContent).toContain("$12,597.12 after 5 years and $5 bonus");
    expect(container.textContent).toContain('const price = "$5"');
    expect(container.textContent).toContain("$10,500");
    expect(getByRole("note", { name: "Note" }).querySelector(".katex")).toBeTruthy();
  });

  it("normalizeMath leaves code untouched", () => {
    expect(normalizeMath("`\\(x\\)` and \\(y\\)")).toBe("`\\(x\\)` and $y$");
    expect(normalizeMath("```py\nprint('\\(z\\)')\n```")).toContain("\\(z\\)");
  });

  it("renders the real compound-interest answer (\\[ \\] blocks in lists, \\$ amounts in a table) without raw source", () => {
    const md = readFileSync(join(__dirname, "fixtures/compound-answer.md"), "utf8");
    const { container } = render(<MarkdownReply>{md}</MarkdownReply>);
    expect(container.querySelectorAll(".katex-display").length).toBe(3);
    expect(container.textContent).not.toMatch(/\\\[|\\\(|\\frac|\$\$/);
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("table")?.textContent).toContain("$12,597.12");
    expect(container.querySelectorAll("li .katex-display").length).toBe(2);
  });
});

import { analyzeRequest } from "@/lib/ai/deep/analyze";
import { validateCandidate, checkTables } from "@/lib/ai/deep/validators";
import { needsFactCheck } from "@/lib/ai/factcheck";

describe("calculation integrity (live mortgage/stats failures)", () => {
  const req = "Calculate the monthly payment for a $200,000 loan at 6% annual interest over 30 years with monthly payments.";
  it("rejects an answer that swaps the user's 6% for another rate", () => {
    const a = analyzeRequest(req);
    expect(a.inputs).toEqual(["6%", "200000"]);
    const bad = "Principal \\$200,000. **Annual nominal interest rate r** 9.569 %. M = \\$1,692.00";
    expect(validateCandidate(bad, a).some((i) => i.code === "inputs_changed")).toBe(true);
    const good = "Principal $P = \\$200{,}000$, rate $r = 6\\%$, $i = 0.005$, $n = 360$. $M \\approx \\$1{,}199.10$";
    expect(validateCandidate(good, a).filter((i) => i.code === "inputs_changed")).toEqual([]);
  });
  it("never web-fact-checks calculations on the user's own figures", () => {
    expect(needsFactCheck(req, "x".repeat(2000) + " The monthly payment is $1,199.10 according to the amortization formula.")).toBe(false);
    expect(needsFactCheck("For the data set 2, 4, 4 compute the mean", "The mean of the data set is 3.33 which is computed by summing.".repeat(20))).toBe(false);
  });
  it("does not flag repeated data rows (2, 4, 4, 4) as duplicates", () => {
    const t = "| x | x − mean | (x − mean)² |\n|---|---|---|\n| 2 | -3 | 9 |\n| 4 | -1 | 1 |\n| 4 | -1 | 1 |\n| 4 | -1 | 1 |";
    expect(checkTables(t)).toEqual([]);
    expect(checkTables("| Name | Role |\n|---|---|\n| Ann | Dev |\n| Ann | Dev |")[0]?.code).toBe("table_duplicate");
  });
});

describe("live Bolt story fixture", () => {
  it("flags the red scarf hung up in scene 18 and worn again in scene 20", () => {
    const t = readFileSync(join(__dirname, "fixtures/bolt-story-live1.md"), "utf8");
    const issues = checkPlot(t, "scene");
    expect(issues.map((i) => i.items)).toEqual([[18, 20]]);
    const fixed = t.replace("hangs his red scarf on a tiny peg", "loosens his red scarf");
    expect(checkPlot(fixed, "scene")).toEqual([]);
  });
});

describe("live stats answer fixture", () => {
  it("passes validation (no false duplicate-row failure) and is not web fact-checked", () => {
    const req = "For the data set 2, 4, 4, 4, 5, 5, 7, 9 compute the mean, median, mode, range, population variance and population standard deviation. Show the formulas and every calculation step.";
    const t = readFileSync(join(__dirname, "fixtures/stats-answer.md"), "utf8");
    expect(validateCandidate(t, analyzeRequest(req))).toEqual([]);
    expect(needsFactCheck(req, t)).toBe(false);
  });
});
