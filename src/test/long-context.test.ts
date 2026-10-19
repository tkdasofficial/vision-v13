// Long Context Generation jobs: catalog planning, record parsing/validation, the
// workbook writer's presentation options, chat routing, and the full pipeline over
// an in-memory vision-sandbox double with a mocked model call (no live providers).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/orchestrator.server", () => ({ orchestrateText: vi.fn(async (_m: unknown, opts: any) => ({ ok: true, text: "[]", sawSignal: opts.signal instanceof AbortSignal })) }));
import { CATALOG_COLUMNS, catalogOutline, normalizeRecord, parseRecords, rowCountFor, validateCatalog, wantsWorkbook } from "@/lib/jobs/long-context";
import { runPipeline, callOrchestrator, withJobHeartbeat } from "@/lib/jobs/long-context.server";
import { readXlsx, writeXlsx } from "@/lib/tools/office";
import { routeRequest } from "@/lib/ai/request-route";

// In-memory D1 double (same SQL surface as src/test/sandbox-generation.test.ts).
function memDb() {
  const jobs = new Map<string, any>();
  const plans: any[] = [];
  const chunks = new Map<string, any>();
  const outputs: any[] = [];
  const events: any[] = [];
  const db = async (sql: string, p: unknown[] = []): Promise<any[]> => {
    const s = sql.replace(/\s+/g, " ").trim();
    const now = Date.now();
    if (s.startsWith("SELECT * FROM generation_jobs WHERE user_id")) return [...jobs.values()].filter((j) => j.user_id === p[0] && j.id === p[1]);
    if (s.startsWith("SELECT * FROM generation_jobs WHERE id")) { const j = jobs.get(p[0] as string); return j && j.user_id === p[1] ? [j] : []; }
    if (s.startsWith("INSERT OR IGNORE INTO generation_jobs")) {
      if (jobs.has(p[0] as string)) return [];
      jobs.set(p[0] as string, { id: p[0], user_id: p[1], instructions: p[2], model_config: p[3], settings: p[4], status: "pending", total_chunks: 0, completed_chunks: 0, error: null, created_at: p[5], updated_at: p[6] });
      return [];
    }
    if (s.startsWith("UPDATE generation_jobs SET status")) {
      const jobId = p.find((x) => typeof x === "string" && jobs.has(x as string)) as string;
      const job = jobs.get(jobId);
      if (!job || job.user_id !== p[p.indexOf(jobId) + 1]) return [];
      if (s.includes("AND status IN")) { const from = p.slice(p.indexOf(jobId) + 2) as string[]; if (!from.includes(job.status)) return []; }
      job.status = p[0]; job.updated_at = p[1];
      if (s.includes("error = ?")) job.error = p[2];
      if (s.includes("total_chunks = ?")) job.total_chunks = p[s.includes("error = ?") ? 3 : 2];
      return [{ id: jobId }];
    }
    if (s.startsWith("UPDATE generation_plans SET status = 'superseded'")) { plans.forEach((pl) => { if (pl.job_id === p[0]) pl.status = "superseded"; }); return []; }
    if (s.startsWith("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM generation_plans")) return [{ v: plans.filter((pl) => pl.job_id === p[0]).length + 1 }];
    if (s.startsWith("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM generation_outputs")) return [{ v: outputs.filter((o) => o.job_id === p[0]).length + 1 }];
    if (s.startsWith("INSERT INTO generation_plans")) { plans.push({ job_id: p[0], version: p[1], outline: p[2], chunk_structure: p[3], dependencies: p[4], context_policy: p[5], status: "active" }); return []; }
    if (s.startsWith("INSERT OR IGNORE INTO generation_chunks")) {
      const key = `${p[1]}:${p[2]}`;
      if (!chunks.has(key)) chunks.set(key, { id: p[0], job_id: p[1], seq: p[2], section_id: p[3], instructions: p[4], content: null, status: "pending", attempts: 0, tokens: 0, checksum: null, error: null, created_at: now, updated_at: now });
      return [];
    }
    if (s.startsWith("UPDATE generation_chunks SET section_id")) return [];
    if (s.startsWith("INSERT INTO generation_context")) return [];
    if (s.startsWith("SELECT p.* FROM generation_plans")) { const pl = plans.filter((x) => x.job_id === p[0] && x.status === "active").pop(); return pl && jobs.get(p[0] as string)?.user_id === p[1] ? [pl] : []; }
    if (s.startsWith("SELECT c.* FROM generation_chunks")) return [...chunks.values()].filter((c) => c.job_id === p[0] && jobs.get(p[0] as string)?.user_id === p[1]).sort((a, b) => a.seq - b.seq);
    if (s.startsWith("UPDATE generation_chunks SET status = 'generating'")) {
      const c = chunks.get(`${p[1]}:${p[2]}`);
      if (!c || !["pending", "failed", "retrying"].includes(c.status)) return [];
      c.status = "generating"; c.attempts++; c.updated_at = now;
      return [c];
    }
    if (s.startsWith("UPDATE generation_chunks SET content")) {
      const c = chunks.get(`${p[4]}:${p[5]}`);
      if (!c || !["generating", "validating", "retrying"].includes(c.status)) return [];
      c.content = p[0]; c.status = "completed"; c.tokens = p[1]; c.checksum = p[2]; c.error = null;
      return [{ id: c.id }];
    }
    if (s.startsWith("UPDATE generation_jobs SET completed_chunks")) return [];
    if (s.startsWith("UPDATE generation_chunks SET status = 'failed'")) {
      const c = chunks.get(`${p[2]}:${p[3]}`);
      if (!c || !["generating", "validating", "retrying", "pending"].includes(c.status)) return [];
      c.status = "failed"; c.error = p[0];
      return [{ id: c.id }];
    }
    if (s.startsWith("UPDATE generation_chunks SET status = 'retrying'")) {
      [...chunks.values()].forEach((c) => { if (c.job_id === p[1] && (p.length === 4 ? c.seq === p[3] && c.status === "failed" : ["failed", "generating", "validating"].includes(c.status))) c.status = "retrying"; });
      return [];
    }
    if (s.startsWith("INSERT INTO generation_outputs")) { outputs.push({ job_id: p[0], version: p[1], content: p[2], validation_status: p[3], validation_detail: p[4] }); return []; }
    if (s.startsWith("SELECT o.* FROM generation_outputs")) return outputs.filter((o) => o.job_id === p[0] && jobs.get(p[0] as string)?.user_id === p[1]).slice(-1);
    if (s.startsWith("INSERT INTO generation_events")) { events.push({ job_id: p[0] }); return []; }
    if (s.startsWith("SELECT e.id")) return events.filter((e) => e.job_id === p[0]);
    throw new Error(`unhandled SQL: ${s}`);
  };
  return { db: db as any, jobs, chunks, plans, outputs };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
function fakeRecord(i: number, cat: string) {
  return { "Product ID": `P-${pad(i, 4)}`, "Product Name": `Test Product ${i}`, Category: cat, Subcategory: "Audio", Brand: `Brand ${i}`, "Product Description": "Fictional item", "Unit Price": 9.99, Currency: "USD", "Stock Quantity": 10, SKU: `SKU-${pad(i, 5)}`, Supplier: "Fictional Supplies", Rating: 4.5, "Review Count": 5, Weight: "1.0 kg", Dimensions: "10 x 10 x 10 cm", "Product Status": "Active" };
}
/** Mocked provider: answers catalog batches with the exact requested ID/SKU ranges. */
function fakeCall(seen: string[], failSections: number[] = []) {
  return async (messages: unknown[]) => {
    const user = String((messages as any[]).find((m) => m.role === "user")?.content ?? "");
    const m = user.match(/Records (\d+)-(\d+): category "([^"]+)"/);
    if (!m) return { ok: true as const, text: "[]" };
    const [start, end, cat] = [Number(m[1]), Number(m[2]), m[3]];
    seen.push(`${start}-${end}`);
    if (failSections.includes(start)) return { ok: false as const, reason: "provider unavailable" };
    const rows: Record<string, unknown>[] = []; for (let i = start; i <= end; i++) rows.push(fakeRecord(i, cat));
    return { ok: true as const, text: JSON.stringify(rows) };
  };
}

describe("catalog planning", () => {
  it("detects workbook requests and row targets", () => {
    expect(wantsWorkbook("Generate an Excel workbook of products")).toBe(true);
    expect(wantsWorkbook("write a story")).toBe(false);
    expect(rowCountFor("500 distinct fictional product records")).toBe(500);
    expect(rowCountFor("a spreadsheet", 500)).toBe(500);
  });

  it("plans batches with unique ID/SKU ranges and rotating categories", () => {
    const outline = catalogOutline(500);
    expect(outline).toHaveLength(10);
    expect(outline[0]).toContain("Records 1-50");
    expect(outline[0]).toContain("P-0001");
    expect(outline[0]).toContain("SKU-00001");
    expect(outline[9]).toContain("Records 451-500");
    expect(outline[1]).not.toContain(outline[0].split(":")[1]);
  });
});

describe("record parsing and validation", () => {
  it("parses JSON arrays behind fences or prose", () => {
    expect(parseRecords("```json\n[{\"a\":1}]\n```")).toEqual([{ a: 1 }]);
    expect(() => parseRecords("no data here")).toThrow();
  });

  it("validates a correct 500-record catalog", () => {
    const rows = Array.from({ length: 500 }, (_, i) => normalizeRecord(fakeRecord(i + 1, "Electronics")));
    expect(validateCatalog(rows, 500)).toEqual({ ok: true });
  });

  it("rejects wrong counts, duplicates, out-of-range and empty values", () => {
    const rows = Array.from({ length: 3 }, (_, i) => normalizeRecord(fakeRecord(i + 1, "Electronics")));
    expect((validateCatalog(rows, 500) as any).problems[0]).toMatch(/Expected 500/);
    const dup = [normalizeRecord(fakeRecord(1, "Electronics")), normalizeRecord(fakeRecord(1, "Electronics"))];
    expect((validateCatalog(dup, 2) as any).problems.join(" ")).toMatch(/duplicate SKU/);
    const bad = normalizeRecord({ ...fakeRecord(1, "Electronics"), Rating: 6, "Stock Quantity": -1, Brand: "" });
    const problems = (validateCatalog([bad], 1) as any).problems.join(" ");
    expect(problems).toMatch(/Rating out of 1-5/);
    expect(problems).toMatch(/invalid Stock Quantity/);
    expect(problems).toMatch(/empty "Brand"/);
  });
});

describe("workbook writer options", () => {
  it("writes frozen header, filter, widths and numeric formats; reads back cleanly", () => {
    const bytes = writeXlsx([{ name: "Products", rows: [["Name", "Price", "Rating"], ["A", 9.99, 4.5]] }], { freezeHeader: true, autoFilter: true, widths: [20, 10, 8], colStyles: { 1: 2, 2: 3 } });
    const xml = new TextDecoder().decode(bytes);
    const sheets = readXlsx(bytes);
    expect(sheets[0].rows).toHaveLength(2);
    expect(sheets[0].rows[1]).toEqual(["A", 9.99, 4.5]);
    // Presentation markers live inside the zip; verify via decompression.
    const { unzipSync, strFromU8 } = require("fflate");
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain("<autoFilter ref=\"A1:C2\"/>");
    expect(sheet).toContain("customWidth");
    expect(sheet).toContain('s="2"');
    void xml;
  });

  it("keeps the default output free of presentation extras", () => {
    const bytes = writeXlsx([{ name: "S", rows: [["a"], [1]] }]);
    const { unzipSync, strFromU8 } = require("fflate");
    const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]);
    expect(sheet).not.toContain("autoFilter");
    expect(sheet).not.toContain("frozen");
  });
});

describe("chat routing", () => {
  it("routes large dataset requests to long-context generation", () => {
    expect(routeRequest("Generate an Excel workbook with 500 product records for a catalog")).toEqual({ kind: "long_context" });
  });
  it("leaves small spreadsheet requests on the regular file path", () => {
    expect(routeRequest("make an excel of my expenses")).toEqual({ kind: "tool" });
  });
});

describe("orchestrator call", () => {
  it("always passes an AbortSignal (regression: jobs failed reading 'aborted')", async () => {
    const res: any = await callOrchestrator([{ role: "user", content: "hi" }], 100);
    expect(res.sawSignal).toBe(true);
  });
});

describe("job heartbeat", () => {
  it("refreshes the job while a long step runs and stops afterwards", async () => {
    let touches = 0;
    const job = { touch: vi.fn(async () => { touches++; }) };
    const done = withJobHeartbeat(job as any, 5, async () => { await new Promise((r) => setTimeout(r, 60)); return "ok"; });
    await expect(done).resolves.toBe("ok");
    expect(touches).toBeGreaterThanOrEqual(2);
    const at = touches;
    await new Promise((r) => setTimeout(r, 30));
    expect(touches).toBe(at);
  });
  it("stops the heartbeat even when the step throws", async () => {
    let touches = 0;
    const job = { touch: vi.fn(async () => { touches++; }) };
    await expect(withJobHeartbeat(job as any, 5, async () => { await new Promise((r) => setTimeout(r, 30)); throw new Error("boom"); })).rejects.toThrow("boom");
    const at = touches;
    await new Promise((r) => setTimeout(r, 30));
    expect(touches).toBe(at);
  });
});

describe("pipeline (mocked provider, in-memory sandbox)", () => {
  const prompt = "Generate an Excel workbook with 200 fictional product records for a catalog";

  it("generates, persists and validates all rows across chunks", async () => {
    const { db, jobs, chunks, outputs } = memDb();
    const seen: string[] = [];
    const result = await runPipeline("u1", "req-1", prompt, { db, call: fakeCall(seen) });
    expect(result.rows).toHaveLength(200);
    expect(result.chunks).toBe(4);
    expect(seen.sort()).toEqual(["1-50", "101-150", "151-200", "51-100"]);
    const sjob = jobs.get(result.sandboxJobId);
    expect(sjob.status).toBe("completed");
    expect([...chunks.values()].every((c) => c.status === "completed" && c.content)).toBe(true);
    expect(outputs.at(-1).validation_status).toBe("valid");
    // Columns land in the required order.
    expect(result.rows?.[0]).toHaveLength(CATALOG_COLUMNS.length);
    expect(result.rows?.[0][0]).toBe("P-0001");
  });

  it("resumes a failed job without regenerating completed chunks", async () => {
    const { db } = memDb();
    const seen1: string[] = [];
    await expect(runPipeline("u1", "req-1", prompt, { db, call: fakeCall(seen1, [101]) })).rejects.toThrow(/could not be generated/);
    const seen2: string[] = [];
    const result = await runPipeline("u1", "req-1", prompt, { db, call: fakeCall(seen2) });
    expect(result.rows).toHaveLength(200);
    // Only the previously failed batch was requested again.
    expect(seen2).toEqual(["101-150"]);
  });

  it("fails honestly when a chunk returns unusable data", async () => {
    const { db, jobs } = memDb();
    const call = async () => ({ ok: true as const, text: "not json at all" });
    await expect(runPipeline("u1", "req-1", prompt, { db, call: call as any })).rejects.toThrow();
    expect([...jobs.values()][0].status).toBe("failed");
  });
  it("automatically retries invalid records and keeps accepted sections", async () => {
    const { db } = memDb();
    const seen: string[] = [];
    const good = fakeCall(seen);
    let invalid = true;
    const call = async (messages: unknown[]) => {
      const t = JSON.stringify(messages);
      if (invalid && t.includes("Records 1-50:")) { invalid = false; return { ok: true, text: "not JSON" }; }
      return good(messages);
    };
    const result = await runPipeline("u1", "retry-invalid", prompt, { db, call });
    expect(result.rows).toHaveLength(200);
    expect(seen.filter((s) => s === "1-50")).toHaveLength(1);
  });
  it("passes exact previous content to dependent sections", async () => {
    const { db } = memDb();
    const call = vi.fn(async (messages: unknown[]) => {
      const user = String((messages[1] as { content: string }).content);
      if (!user.includes("Your task:")) return { ok: true, text: '["Start", "Continue with the ending"]' };
      if (user.includes('Write the section "Start"')) return { ok: true, text: "The key stays with Mira at the station." };
      expect(user).toContain('Earlier section "Start" (full text)');
      expect(user).toContain("The key stays with Mira at the station.");
      return { ok: true, text: "Mira unlocks the station door with the same key." };
    });
    const result = await runPipeline("u1", "continuity", "Write a long two-part story", { db, call });
    expect(result.text).toBe("The key stays with Mira at the station.\n\nMira unlocks the station door with the same key.");
  });
  it("persists thrown provider errors without blindly retrying", async () => {
    const { db, jobs, chunks } = memDb();
    const call = vi.fn(async () => { throw new Error("Provider connection closed"); });
    await expect(runPipeline("u1", "thrown", "Generate Excel with 50 product records", { db, call })).rejects.toThrow("Provider connection closed");
    expect(call).toHaveBeenCalledTimes(1);
    expect(jobs.get("thrown")).toMatchObject({ status: "failed", error: "Provider connection closed" });
    expect([...chunks.values()][0]).toMatchObject({ status: "failed", error: "Provider connection closed" });
  });
  it("does not reset another active chunk during an invalid-record retry", async () => {
    const { db, chunks } = memDb();
    const good = fakeCall([]);
    let invalid = true;
    const call = async (messages: unknown[]) => {
      if (JSON.stringify(messages).includes("Records 1-50:") && invalid) {
        invalid = false;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true, text: "invalid JSON" };
      }
      if (JSON.stringify(messages).includes("Records 51-100:")) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(chunks.get("isolated:1")?.status).toBe("generating");
      }
      return good(messages);
    };
    const result = await runPipeline("u1", "isolated", "Generate Excel with 100 product records", { db, call });
    expect(result.rows).toHaveLength(100);
  });
});
