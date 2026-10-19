import { describe, it, expect, vi } from "vitest";
import { webSearch, sourcesBlock, canonicalUrl, SearchError } from "@/lib/search/search.server";

const sleep = async () => {};
const mk = (id: string, impl: () => Promise<any[]>) => ({ id, available: () => true, search: vi.fn(impl) });
const hit = (url: string) => ({ title: "T", url, snippet: "s", source: "x" });

describe("webSearch reliability", () => {
  it("keeps results when one provider fails (partial)", async () => {
    const a = mk("a", async () => [hit("https://a.com/1")]);
    const b = mk("b", async () => { throw new SearchError(404, "nf"); });
    const r = await webSearch("q", { providers: [a, b], sleep });
    expect(r.status).toBe("partial"); expect(r.results).toHaveLength(1); expect(r.failed).toEqual(["b"]);
  });
  it("retries a transient failure and recovers", async () => {
    let n = 0; const a = mk("a", async () => { if (n++ === 0) throw new SearchError(503, "busy"); return [hit("https://a.com/1")]; });
    const r = await webSearch("q", { providers: [a], sleep });
    expect(r.status).toBe("ok"); expect(a.search).toHaveBeenCalledTimes(2);
  });
  it("does not retry permanent errors", async () => {
    const a = mk("a", async () => { throw new SearchError(400, "bad"); });
    const r = await webSearch("q", { providers: [a], sleep });
    expect(r.status).toBe("failed"); expect(a.search).toHaveBeenCalledTimes(1);
  });
  it("retries are bounded", async () => {
    const a = mk("a", async () => { throw new SearchError(503, "busy"); });
    await webSearch("q", { providers: [a], sleep });
    expect(a.search).toHaveBeenCalledTimes(2);
  });
  it("cancellation stops retries", async () => {
    const c = new AbortController();
    const a = mk("a", async () => { c.abort(); throw new SearchError(503, "busy"); });
    await webSearch("q", { providers: [a], sleep, signal: c.signal });
    expect(a.search).toHaveBeenCalledTimes(1);
  });
  it("reports empty separately from failed", async () => {
    const r = await webSearch("q", { providers: [mk("a", async () => [])], sleep });
    expect(r.status).toBe("empty");
    expect(sourcesBlock([], "failed")).toMatch(/no live sources were checked/);
    expect(sourcesBlock([], "empty")).toMatch(/found no relevant sources/);
  });
  it("dedupes equivalent URLs across providers but keeps distinct ones", async () => {
    const r = await webSearch("q", { providers: [mk("a", async () => [hit("https://www.a.com/x/?utm_source=1"), hit("https://a.com/y")]), mk("b", async () => [hit("https://a.com/x#top")])], sleep });
    expect(r.results.map((x) => x.url)).toEqual(["https://www.a.com/x/?utm_source=1", "https://a.com/y"]);
    expect(canonicalUrl("https://www.A.com/x/")).toBe("a.com/x");
  });
});
