import { describe, it, expect } from "vitest";
import { allClaims, extractClaims, findPassages, judgeClaim, needsFactCheck, runFactCheck, sourceQuality, type Evidence, type SearchHit } from "@/lib/ai/factcheck";
import { claimCheckStore, htmlToText } from "@/lib/ai/factcheck.server";

const NOW = Date.UTC(2026, 9, 15);
const ev = (passage: string, url: string, fullPage = true): Evidence => ({ title: "Source", url, domain: new URL(url).hostname, passage, fullPage, retrievedAt: NOW, quality: sourceQuality(url) });
const claim = "The Eiffel Tower in Paris was completed in 1889.";

describe("judgement (mocked evidence)", () => {
  it("full-page support from a strong source verifies; a snippet alone never does", () => {
    expect(judgeClaim(1, claim, [ev("The Eiffel Tower in Paris was completed in 1889 for the fair.", "https://en.wikipedia.org/x")], NOW).status).toBe("verified");
    const snip = judgeClaim(1, claim, [ev("The Eiffel Tower in Paris was completed in 1889.", "https://en.wikipedia.org/x", false)], NOW);
    expect(snip.status).toBe("partial"); expect(snip.reason).toMatch(/summaries/);
  });
  it("one low-quality source is only partial; two independent domains verify; same domain counts once", () => {
    const p = "The Eiffel Tower in Paris was completed in 1889.";
    expect(judgeClaim(1, claim, [ev(p, "https://blog-a.com/1")], NOW).status).toBe("partial");
    expect(judgeClaim(1, claim, [ev(p, "https://blog-a.com/1"), ev(p, "https://blog-a.com/2")], NOW).status).toBe("partial");
    expect(judgeClaim(1, claim, [ev(p, "https://blog-a.com/1"), ev(p, "https://blog-b.com/1")], NOW).status).toBe("verified");
  });
  it("contradicted, conflicting and unverified", () => {
    expect(judgeClaim(1, claim, [ev("The Eiffel Tower in Paris was completed in 1887 per records.", "https://x.gov/a")], NOW).status).toBe("contradicted");
    expect(judgeClaim(1, claim, [ev("The Eiffel Tower in Paris was completed in 1889.", "https://x.gov/a"), ev("The Eiffel Tower in Paris was completed in 1887.", "https://y.edu/b")], NOW).status).toBe("conflicting");
    expect(judgeClaim(1, claim, [], NOW).status).toBe("unverified");
  });
  it("checks non-numeric claims, including opposite polarity", () => {
    const c = "Canberra is the capital of Australia.";
    expect(judgeClaim(1, c, [ev("Canberra is the capital city of Australia, located in the ACT.", "https://australia.gov.au/a")], NOW).status).toBe("verified");
    expect(judgeClaim(1, c, [ev("Canberra is not the capital of Australia, contrary to belief.", "https://australia.gov.au/a")], NOW).status).toBe("contradicted");
  });
  it("treats outdated evidence for changing facts as not proof", () => {
    const c = "The population of Tuvalu is currently 11,000 people.";
    const r = judgeClaim(1, c, [ev("In 2012 the population of Tuvalu was 11,000 people.", "https://stats.gov.tv/a")], NOW);
    expect(r.status).toBe("partial"); expect(r.support).toHaveLength(0);
  });
});

describe("claim detection and passages", () => {
  it("finds descriptive, causal and location claims, not advice", () => {
    const a = "Mount Kilimanjaro is located in Tanzania. Erosion is caused by wind and water over time. You should drink water daily.";
    const cs = allClaims(a);
    expect(cs).toContain("Mount Kilimanjaro is located in Tanzania.");
    expect(cs.some((c) => c.startsWith("Erosion"))).toBe(true);
    expect(cs.some((c) => c.startsWith("You should"))).toBe(false);
  });
  it("skips creative and code requests; caps checked claims", () => {
    expect(needsFactCheck("write a poem about Paris", claim + " " + claim)).toBe(false);
    const many = Array.from({ length: 10 }, (_, i) => `Item ${i} City Number${i} has ${1000 + i} residents.`).join("\n");
    expect(extractClaims(many)).toHaveLength(6);
  });
  it("extracts exact passages from full page text", () => {
    const page = htmlToText("<html><script>x=1</script><p>Intro about Paris.</p><p>The Eiffel Tower was completed in 1889 by Gustave Eiffel's company.</p></html>");
    expect(page).not.toContain("x=1");
    expect(findPassages(claim, page)[0]).toContain("completed in 1889");
  });
});

describe("runFactCheck pipeline", () => {
  const hits: SearchHit[] = [{ title: "Eiffel", url: "https://a.gov/e", snippet: "Eiffel Tower" }, { title: "Eiffel", url: "https://b.edu/e", snippet: "Eiffel Tower" }];
  const page = "The Eiffel Tower in Paris was completed in 1889 for the World Fair. It is iron.";
  const answer = `${claim} It is a famous landmark.`;
  it("emits no statuses when there are no claims", async () => {
    const st: string[] = [];
    const r = await runFactCheck("Sure, happy to help with that today.", { search: async () => ({ ok: true, results: [] }), emit: (s) => st.push(s) });
    expect(r.ran).toBe(false); expect(st).toEqual([]);
  });
  it("corrects a contradicted claim and re-verifies without re-searching or re-reading", async () => {
    const st: string[] = []; let searches = 0, reads = 0;
    const r = await runFactCheck(answer.replace("1889", "1887"), {
      search: async () => { searches++; return { ok: true, results: hits }; },
      fetchPage: async () => { reads++; return page + " ".repeat(200); },
      correct: async (t) => t.replace("1887", "1889"), emit: (s) => st.push(s), now: () => NOW,
    });
    expect(r.corrected).toBe(true);
    expect(r.records[0].status).toBe("verified");
    expect(st.slice(0, 7)).toEqual(["verifying_accuracy", "searching_web", "reading_sources", "comparing_sources", "fact_checking", "detecting_issues", "fixing_issues"]);
    expect(st).not.toContain("completed");
    expect(searches).toBe(2); // corrected claim has a new query; original is cached
    expect(reads).toBe(2); // each page read once
    expect(r.text).toContain("Fact-check: 1 key statement was checked");
    expect(r.text).toContain("https://a.gov/e");
  });
  it("discloses when a correction still fails (bounded to one round)", async () => {
    let calls = 0;
    const r = await runFactCheck(answer.replace("1889", "1887"), {
      search: async () => ({ ok: true, results: hits }), fetchPage: async () => page + " ".repeat(200),
      correct: async (t) => { calls++; return t; }, now: () => NOW,
    });
    expect(calls).toBe(1); expect(r.rounds).toBe(2);
    expect(r.text).toContain("Contradicted");
  });
  it("handles failed search and inaccessible pages honestly", async () => {
    const st: string[] = [];
    const r = await runFactCheck(answer, { search: async () => { throw new Error("down"); }, emit: (s) => st.push(s) });
    expect(r.searchFailed).toBe(true); expect(r.records[0].status).toBe("unverified");
    expect(st).not.toContain("reading_sources");
    expect(r.text).toContain("Web search was partly unavailable");
    const r2 = await runFactCheck(answer, { search: async () => ({ ok: true, results: [{ ...hits[0], snippet: claim }] }), fetchPage: async () => null, now: () => NOW });
    expect(r2.pagesFailed).toBe(1); expect(r2.records[0].status).toBe("partial");
  });
  it("reports partial scope when some statements were not checked", async () => {
    const many = Array.from({ length: 8 }, (_, i) => `City Number${i} in Region${i} has ${1000 + i} residents.`).join("\n");
    const r = await runFactCheck(many, { search: async () => ({ ok: true, results: [] }), now: () => NOW });
    expect(r.unchecked).toHaveLength(2);
    expect(r.text).toContain("2 other statements were not checked");
  });
});

describe("claim record persistence", () => {
  it("scopes every read and write to the user", async () => {
    const rows: any[] = [];
    const exec = async (sql: string, p: any[] = []) => {
      if (sql.startsWith("INSERT")) { rows.push({ user_id: p[1], conversation_id: p[2], message_id: p[3], records: p[4], summary: p[5] }); return []; }
      if (sql.startsWith("SELECT")) { expect(sql).toContain("user_id = ?"); return rows.filter((r) => r.user_id === p[0] && r.message_id === p[1]); }
      return [];
    };
    const result = { text: "", records: [judgeClaim(1, claim, [], NOW)], unchecked: [], ran: true, corrected: false, searchFailed: false, rounds: 1, pagesRead: 0, pagesFailed: 0 };
    await claimCheckStore(exec, "alice").save("msg-12345678", "chat-1", result);
    expect((await claimCheckStore(exec, "alice").get("msg-12345678"))?.records[0].claim).toBe(claim);
    expect(await claimCheckStore(exec, "bob").get("msg-12345678")).toBeNull();
  });
});
