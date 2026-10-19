import { describe, expect, it } from "vitest";
import { filterGuide, type GuideSection } from "@/lib/app-guide";
const fixture: GuideSection[] = [
  { id: "a", title: "Workspace", entries: [{ title: "Files", steps: ["Choose an image"], note: "Size limits apply" }, { title: "Messages", steps: ["Write text"] }] },
  { id: "b", title: "Preferences", entries: [{ title: "Motion", steps: ["Reduce movement"] }] },
];
describe("Guide topic filtering", () => {
  it("preserves all topics for blank input", () => expect(filterGuide(fixture, "  ")).toBe(fixture));
  it("matches all terms ignoring case", () => expect(filterGuide(fixture, "WORKSPACE image LIMITS")).toEqual([{ ...fixture[0], entries: [fixture[0].entries[0]] }]));
  it("does not mutate the source", () => { expect(filterGuide(fixture, "movement")).toEqual([fixture[1]]); expect(fixture[0].entries).toHaveLength(2); });
  it("returns no topics when one term is absent", () => expect(filterGuide(fixture, "image unicorn")).toEqual([]));
});
