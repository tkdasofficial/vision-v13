// Translates app data requests into safe SQL for D1 and enforces who may read/write each table.
import { d1 } from "./d1.server";
import { TABLES, type ColKind } from "./schema.server";
import type { Caller } from "./auth.server";
import type { QuerySpec, QueryResult } from "./query-types";

type Access = "owner" | "self" | "session" | "authed" | "admin";
type Policy = { read: Access; write: Access };

// Non-admins only ever see or change rows they own; admins can manage everything.
const POLICIES: Record<string, Policy> = {
  background_tasks: { read: "owner", write: "owner" },
  chat_sessions: { read: "owner", write: "owner" },
  chat_messages: { read: "session", write: "session" },
  leads: { read: "owner", write: "owner" },
  outreach_campaigns: { read: "owner", write: "owner" },
  prospecting_jobs: { read: "owner", write: "owner" },
  story_projects: { read: "owner", write: "owner" },
  support_tickets: { read: "owner", write: "owner" },
  user_2fa: { read: "owner", write: "owner" },
  user_settings: { read: "owner", write: "owner" },
  workspace_projects: { read: "owner", write: "owner" },
  // File records are readable by their owner; writes happen only through the
  // Drive-backed upload route, never directly from the browser.
  user_files: { read: "owner", write: "admin" },
  subscriptions: { read: "owner", write: "admin" },
  user_roles: { read: "owner", write: "admin" },
  profiles: { read: "self", write: "self" },
  announcements: { read: "authed", write: "admin" },
  plan_limits: { read: "authed", write: "admin" },
  feature_flags: { read: "authed", write: "admin" },
  admin_notifications: { read: "authed", write: "admin" },
  admin_audit_log: { read: "admin", write: "admin" },
  ai_usage_logs: { read: "admin", write: "admin" },
};

// Columns ordinary users may never set themselves.
const PROTECTED_COLS: Record<string, string[]> = {
  profiles: ["id", "is_banned", "email"],
  support_tickets: ["admin_reply", "replied_at", "replied_by"],
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

class Forbidden extends Error {}

function colExpr(table: string, col: string): { sql: string; kind: ColKind } {
  const [base, key] = col.split(/->>?/);
  const kind = TABLES[table]!.cols[base!];
  if (!kind) throw new Error(`Unknown column ${col}`);
  if (key !== undefined) {
    if (!IDENT.test(key)) throw new Error(`Invalid column ${col}`);
    return { sql: `json_extract(${base}, '$.${key}')`, kind: "text" };
  }
  return { sql: base!, kind };
}

function encode(kind: ColKind, v: any) {
  if (v === undefined || v === null) return null;
  if (kind === "bool") return v ? 1 : 0;
  if (kind === "json") return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function decode(table: string, row: Record<string, any>) {
  const cols = TABLES[table]!.cols;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const kind = cols[k];
    if (kind === "bool") out[k] = v === null ? null : !!v;
    else if (kind === "json" && typeof v === "string") { try { out[k] = JSON.parse(v); } catch { out[k] = v; } }
    else out[k] = v;
  }
  return out;
}

function scopeClause(table: string, access: Access, caller: Caller | null): { sql: string; params: any[] } {
  if (!caller) throw new Forbidden("Please sign in to continue.");
  if (caller.isAdmin) return { sql: "1=1", params: [] };
  const uid = caller.user.id;
  switch (access) {
    case "owner": return { sql: "user_id = ?", params: [uid] };
    case "self": return { sql: "id = ?", params: [uid] };
    case "session": return { sql: "session_id IN (SELECT id FROM chat_sessions WHERE user_id = ?)", params: [uid] };
    case "authed": return { sql: "1=1", params: [] };
    case "admin": throw new Forbidden("You don't have permission to do that.");
  }
}

function whereFromFilters(spec: QuerySpec) {
  const parts: string[] = [];
  const params: any[] = [];
  for (const f of spec.filters) {
    const { sql: c, kind } = colExpr(spec.table, f.col);
    let clause: string;
    switch (f.op) {
      case "eq": clause = `${c} = ?`; params.push(encode(kind, f.val)); break;
      case "neq": clause = `${c} != ?`; params.push(encode(kind, f.val)); break;
      case "gt": clause = `${c} > ?`; params.push(encode(kind, f.val)); break;
      case "gte": clause = `${c} >= ?`; params.push(encode(kind, f.val)); break;
      case "lt": clause = `${c} < ?`; params.push(encode(kind, f.val)); break;
      case "lte": clause = `${c} <= ?`; params.push(encode(kind, f.val)); break;
      case "like": clause = `${c} LIKE ?`; params.push(f.val); break;
      case "ilike": clause = `LOWER(${c}) LIKE LOWER(?)`; params.push(f.val); break;
      case "is": clause = f.val === null ? `${c} IS NULL` : `${c} = ?`; if (f.val !== null) params.push(encode(kind, f.val)); break;
      case "in": {
        const list = Array.isArray(f.val) ? f.val : [];
        if (!list.length) { clause = "0=1"; break; }
        clause = `${c} IN (${list.map(() => "?").join(",")})`;
        params.push(...list.map((x: any) => encode(kind, x)));
        break;
      }
      default: throw new Error(`Unsupported filter ${f.op}`);
    }
    parts.push(f.neg ? `NOT (${clause})` : clause);
  }
  return { parts, params };
}

function cleanRow(spec: QuerySpec, row: Record<string, any>, caller: Caller, isInsert: boolean) {
  const cols = TABLES[spec.table]!.cols;
  const out: Record<string, any> = {};
  const blocked = caller.isAdmin ? [] : PROTECTED_COLS[spec.table] ?? [];
  for (const [k, v] of Object.entries(row)) {
    if (!cols[k] || v === undefined) continue;
    if (blocked.includes(k)) continue;
    out[k] = v;
  }
  const policy = POLICIES[spec.table]!;
  if (!caller.isAdmin && policy.write === "owner" && "user_id" in cols) {
    if (isInsert) out.user_id = caller.user.id; else delete out.user_id;
  }
  const now = new Date().toISOString();
  if (isInsert) {
    const key = TABLES[spec.table]!.key;
    if (key === "id" && !out.id) out.id = crypto.randomUUID();
    if ("created_at" in cols && !out.created_at) out.created_at = now;
  }
  if ("updated_at" in cols) out.updated_at = now;
  return out;
}

async function assertSessionsOwned(rows: Record<string, any>[], caller: Caller) {
  if (caller.isAdmin) return;
  const ids = [...new Set(rows.map((r) => r.session_id).filter(Boolean))];
  if (rows.some((r) => !r.session_id)) throw new Forbidden("Message must belong to a chat.");
  const owned = await d1<{ id: string }>(
    `SELECT id FROM chat_sessions WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    [caller.user.id, ...ids],
  );
  if (owned.length !== ids.length) throw new Forbidden("You don't have permission to do that.");
}

async function insertRows(spec: QuerySpec, rows: Record<string, any>[]) {
  const cols = TABLES[spec.table]!.cols;
  const out: any[] = [];
  for (const r of rows) {
    const keys = Object.keys(r);
    const sql = `INSERT INTO ${spec.table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) RETURNING *`;
    const res = await d1(sql, keys.map((k) => encode(cols[k]!, r[k])));
    out.push(...res);
  }
  return out;
}

export async function runQuery(spec: QuerySpec, caller: Caller | null): Promise<QueryResult> {
  try {
    if (!TABLES[spec.table] || !POLICIES[spec.table]) throw new Forbidden("Unknown data");
    const policy = POLICIES[spec.table]!;
    const tcols = TABLES[spec.table]!.cols;
    const { parts, params } = whereFromFilters(spec);
    let rows: any[] = [];
    let count: number | null = null;

    if (spec.action === "select") {
      const scope = scopeClause(spec.table, policy.read, caller);
      const where = [scope.sql, ...parts].join(" AND ");
      const allParams = [...scope.params, ...params];
      if (spec.count) {
        const c = await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${where}`, allParams);
        count = c[0]?.n ?? 0;
      }
      if (!spec.head) {
        let sql = `SELECT * FROM ${spec.table} WHERE ${where}`;
        if (spec.orders.length) sql += " ORDER BY " + spec.orders.map((o) => `${colExpr(spec.table, o.col).sql} ${o.asc ? "ASC" : "DESC"}`).join(", ");
        let limit = spec.limit;
        let offset = 0;
        if (spec.rangeFrom !== null) { offset = spec.rangeFrom; limit = (spec.rangeTo ?? offset + 999) - offset + 1; }
        sql += ` LIMIT ${Math.min(Math.max(1, Number(limit ?? 1000)), 1000)} OFFSET ${Math.max(0, Number(offset))}`;
        rows = await d1(sql, allParams);
      }
    } else {
      scopeClause(spec.table, policy.write, caller); // throws for forbidden writes
      const c = caller!;
      if (spec.action === "insert" || spec.action === "upsert") {
        if (!c.isAdmin && policy.write === "self") throw new Forbidden("You don't have permission to do that.");
        const list = (Array.isArray(spec.payload) ? spec.payload : [spec.payload]).slice(0, 500);
        if (spec.action === "insert") {
          const clean = list.map((r: any) => cleanRow(spec, r, c, true));
          if (policy.write === "session") await assertSessionsOwned(clean, c);
          rows = await insertRows(spec, clean);
        } else {
          const keys = (spec.upsertKey || TABLES[spec.table]!.key).split(",").map((k) => k.trim());
          keys.forEach((k) => { if (!tcols[k]) throw new Error(`Unknown column ${k}`); });
          const scope = scopeClause(spec.table, policy.write, c);
          for (const raw of list) {
            const existing = keys.every((k) => raw[k] !== undefined)
              ? await d1(`SELECT * FROM ${spec.table} WHERE ${keys.map((k) => `${k} = ?`).join(" AND ")} LIMIT 1`, keys.map((k) => encode(tcols[k]!, raw[k])))
              : [];
            if (existing[0]) {
              // Only update rows the caller is allowed to change.
              const ok = await d1(`SELECT 1 FROM ${spec.table} WHERE ${keys.map((k) => `${k} = ?`).join(" AND ")} AND ${scope.sql}`, [...keys.map((k) => encode(tcols[k]!, raw[k])), ...scope.params]);
              if (!ok[0]) throw new Forbidden("You don't have permission to do that.");
              const patch = cleanRow(spec, raw, c, false);
              keys.forEach((k) => delete patch[k]);
              const pk = Object.keys(patch);
              if (pk.length) {
                rows.push(...await d1(
                  `UPDATE ${spec.table} SET ${pk.map((k) => `${k} = ?`).join(", ")} WHERE ${keys.map((k) => `${k} = ?`).join(" AND ")} RETURNING *`,
                  [...pk.map((k) => encode(tcols[k]!, patch[k])), ...keys.map((k) => encode(tcols[k]!, raw[k]))],
                ));
              } else rows.push(existing[0]);
            } else {
              const clean = cleanRow(spec, raw, c, true);
              if (policy.write === "session") await assertSessionsOwned([clean], c);
              rows.push(...await insertRows(spec, [clean]));
            }
          }
        }
      } else {
        if (!parts.length) throw new Forbidden("A filter is required for changes.");
        const scope = scopeClause(spec.table, policy.write, c);
        const where = [scope.sql, ...parts].join(" AND ");
        if (spec.action === "update") {
          const patch = cleanRow(spec, spec.payload ?? {}, c, false);
          const pk = Object.keys(patch);
          rows = pk.length
            ? await d1(`UPDATE ${spec.table} SET ${pk.map((k) => `${k} = ?`).join(", ")} WHERE ${where} RETURNING *`, [...pk.map((k) => encode(tcols[k]!, patch[k])), ...scope.params, ...params])
            : [];
        } else {
          if (!c.isAdmin && policy.write === "self") throw new Forbidden("You don't have permission to do that.");
          rows = await d1(`DELETE FROM ${spec.table} WHERE ${where} RETURNING *`, [...scope.params, ...params]);
        }
      }
      if (!spec.returning) return { data: null, error: null, rows: rows.map((r) => decode(spec.table, r)) };
    }

    const data = rows.map((r) => decode(spec.table, r));
    if (spec.head) return { data: null, error: null, count };
    if (spec.mode === "single") {
      if (data.length !== 1) return { data: null, error: { message: "Row not found", code: "PGRST116" }, count: null };
      return { data: data[0], error: null, count };
    }
    if (spec.mode === "maybe") return { data: data[0] ?? null, error: null, count };
    return { data, error: null, count };
  } catch (e: any) {
    const message = e instanceof Forbidden ? e.message : e?.message?.startsWith("Unknown") || e?.message?.startsWith("Unsupported") || e?.message?.startsWith("Invalid") ? e.message : "Something went wrong saving your data.";
    if (!(e instanceof Forbidden)) console.error("[data]", spec.table, spec.action, e);
    return { data: null, error: { message } };
  }
}
