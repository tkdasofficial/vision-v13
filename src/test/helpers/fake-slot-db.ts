// Shared in-memory stand-in for the vision-sandbox slot tables (used by slot and story-run tests).
// Minimal in-memory stand-in for the D1 slot tables, honoring the same
// conditional-UPDATE semantics (status guards, ownership filters).
export function fakeDb() {
  const slots = new Map<number, any>();
  const records = new Map<string, any>();
  const db = async (sql: string, params: unknown[] = []): Promise<any[]> => {
    if (sql.startsWith("CREATE TABLE")) return [];
    if (sql.startsWith("INSERT OR IGNORE INTO generation_slots")) {
      const [id, type] = params as [number, string];
      if (!slots.has(id)) slots.set(id, { slot_id: id, slot_type: type, user_id: null, job_id: null, prompt_index: null, status: "free", result: null, result_ref: null, blueprint_ref: null, story_ref: null, findings: null, repair_attempts: 0, error_code: null, created_at: null, updated_at: null });
      return [];
    }
    if (sql.startsWith("INSERT INTO generation_records")) {
      const [id, user_id, job_id, slot_id, kind, content, checksum, created_at] = params as any[];
      records.set(id, { id, user_id, job_id, slot_id, kind, content, checksum, created_at });
      return [];
    }
    if (sql.startsWith("SELECT content, checksum FROM generation_records")) {
      const [id, user_id] = params as [string, string];
      const r = records.get(id);
      return r && r.user_id === user_id ? [{ content: r.content, checksum: r.checksum }] : [];
    }
    if (sql.includes("FROM generation_slots WHERE user_id = ? AND job_id = ? AND slot_type = 'prompt'")) {
      const [user_id, job_id] = params as [string, string];
      return [...slots.values()].filter((s) => s.user_id === user_id && s.job_id === job_id && s.slot_type === "prompt");
    }
    if (sql.startsWith("SELECT * FROM generation_slots WHERE user_id = ? AND job_id = ? ORDER BY slot_id")) {
      const [user_id, job_id] = params as [string, string];
      return [...slots.values()].filter((s) => s.user_id === user_id && s.job_id === job_id).sort((a, b) => a.slot_id - b.slot_id);
    }
    if (sql.startsWith("SELECT slot_id, slot_type, status FROM generation_slots ORDER BY slot_id")) {
      return [...slots.values()].map((s) => ({ slot_id: s.slot_id, slot_type: s.slot_type, status: s.status })).sort((a, b) => a.slot_id - b.slot_id);
    }
    if (sql.startsWith("SELECT * FROM generation_slots WHERE slot_id = ?")) {
      const [slot_id, user_id, job_id] = params as [number, string, string];
      const s = slots.get(slot_id);
      return s && s.user_id === user_id && s.job_id === job_id ? [s] : [];
    }
    if (sql.startsWith("UPDATE generation_slots SET user_id = ?, job_id = ?, status = 'claimed'")) {
      const [user_id, job_id, , slot_id, ou, oj] = params as any[];
      const s = slots.get(slot_id);
      if (s && (s.status === "free" || (s.user_id === ou && s.job_id === oj))) {
        Object.assign(s, { user_id, job_id, status: "claimed", updated_at: Date.now() });
        return [{ slot_id }];
      }
      return [];
    }
    if (sql.startsWith("UPDATE generation_slots SET user_id = ?, job_id = ?, prompt_index = ?")) {
      const [user_id, job_id, prompt_index, , slot_id] = params as any[];
      const s = slots.get(slot_id);
      if (s && s.status === "free") {
        Object.assign(s, { user_id, job_id, prompt_index, status: "claimed", repair_attempts: 0, findings: null, error_code: null, updated_at: Date.now() });
        return [{ slot_id }];
      }
      return [];
    }
    if (sql.startsWith("UPDATE generation_slots SET findings = ?, updated_at = ?")) {
      const [findings, , slot_id, user_id, job_id] = params as any[];
      const s = slots.get(slot_id);
      if (!s || s.user_id !== user_id || s.job_id !== job_id || s.status !== "generating") return [];
      s.findings = findings;
      return [{ slot_id }];
    }
    if (sql.startsWith("UPDATE generation_slots SET status = ?")) {
      const to = params[0] as string;
      const slot_id = params[params.length - 4] as number;
      const user_id = params[params.length - 3] as string;
      const from = params[params.length - 1] as string;
      const s = slots.get(slot_id);
      if (!s || s.user_id !== user_id || s.status !== from) return [];
      s.status = to;
      s.updated_at = Date.now();
      if (to === "repaired_unverified") s.repair_attempts += 1;
      // apply patch params in SET order: status, updated_at, then patched keys
      const keys = ["result", "result_ref", "findings", "error_code", "blueprint_ref", "story_ref"];
      const patchValues = params.slice(2, params.length - 4);
      const setMatch = sql.match(/SET (.+) WHERE/)![1].split(",").map((p) => p.trim());
      const setKeys = setMatch.slice(2).map((p) => p.split(" ")[0]);
      setKeys.forEach((k, i) => { if (keys.includes(k)) s[k] = patchValues[i]; });
      return [{ slot_id }];
    }
    if (sql.includes("SET status = 'free', user_id = NULL")) {
      const [, user_id, job_id] = params as any[];
      const mine = [...slots.values()].filter((s) => s.user_id === user_id && s.job_id === job_id);
      for (const s of mine) Object.assign(s, { status: "free", user_id: null, job_id: null, prompt_index: null, result: null, result_ref: null, blueprint_ref: null, story_ref: null, findings: null, repair_attempts: 0, error_code: null });
      return mine.map((s) => ({ slot_id: s.slot_id }));
    }
    throw new Error(`fakeDb: unhandled SQL: ${sql.slice(0, 80)}`);
  };
  return { db, slots, records };
}
