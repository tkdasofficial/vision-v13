// Explicit input/output schemas for registry tools. Input schemas are parsed from each tool's declared
// `params` signature (single source of truth), then enforced before execution. Pure, tested.

export type FieldType = { kind: "string" | "number" | "boolean" | "array" | "object" | "any" } | { kind: "enum"; values: (string | number)[] };
export type ParamSchema = Record<string, { optional: boolean; type: FieldType }>;

function typeOf(raw: string): FieldType {
  const t = raw.trim().replace(/\s*\(.*$/, "");
  if (/^("[^"]*"|\d+)(\s*\|\s*("[^"]*"|\d+))+$/.test(t)) return { kind: "enum", values: t.split("|").map((v) => v.trim()).map((v) => (v.startsWith('"') ? v.slice(1, -1) : Number(v))) };
  if (/\[\]$/.test(t) || /^\[/.test(t)) return { kind: "array" };
  if (/^\{/.test(t)) return { kind: "object" };
  if (/^string\b/.test(t)) return { kind: "string" };
  if (/^number\b/.test(t)) return { kind: "number" };
  if (/^boolean\b/.test(t)) return { kind: "boolean" };
  return { kind: "any" };
}

/** Parses e.g. '{"to": "pdf"|"docx", "title"?: string, "pages"?: number[]}' into a schema. */
export function parseParamSpec(spec: string): ParamSchema {
  const out: ParamSchema = {};
  const body = spec.trim().replace(/^\{|\}$/g, "");
  let depth = 0, cur = "";
  const parts: string[] = [];
  for (const ch of body) {
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const m = /^\s*"([\w]+)"(\?)?\s*:\s*([\s\S]+)$/.exec(p);
    if (m) out[m[1]] = { optional: !!m[2], type: typeOf(m[3]) };
  }
  return out;
}

/** Validates (and lightly coerces numeric/boolean strings). Returns actionable errors. */
export function validateParams(schema: ParamSchema, params: Record<string, unknown>): { ok: true; params: Record<string, unknown> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const clean: Record<string, unknown> = { ...params }; // undeclared keys (e.g. routed "file") pass through
  for (const [k, f] of Object.entries(schema)) {
    let v = params[k];
    if (v === undefined || v === null || v === "") { if (!f.optional) errors.push(`"${k}" is required`); continue; }
    const t = f.type;
    if (t.kind === "number" && typeof v === "string" && v.trim() && Number.isFinite(Number(v))) v = Number(v);
    if (t.kind === "boolean" && (v === "true" || v === "false")) v = v === "true";
    if (t.kind === "enum" && !t.values.some((x) => String(x) === String(v))) errors.push(`"${k}" must be one of ${t.values.join(", ")}`);
    else if (t.kind === "number" && (typeof v !== "number" || !Number.isFinite(v))) errors.push(`"${k}" must be a number`);
    else if (t.kind === "string" && typeof v !== "string") errors.push(`"${k}" must be text`);
    else if (t.kind === "boolean" && typeof v !== "boolean") errors.push(`"${k}" must be true or false`);
    else if (t.kind === "array" && !Array.isArray(v)) errors.push(`"${k}" must be a list`);
    else if (t.kind === "object" && (typeof v !== "object" || Array.isArray(v))) errors.push(`"${k}" must be an object`);
    clean[k] = t.kind === "enum" && typeof t.values[0] === "number" ? Number(v) : v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, params: clean };
}

/** Output schema shared by every tool: at least one well-formed result field. */
export function validateToolOut(out: unknown): string | null {
  if (!out || typeof out !== "object") return "tool returned no result";
  const o = out as any;
  if (o.text !== undefined && typeof o.text !== "string") return "text result is malformed";
  if (o.table !== undefined && !(Array.isArray(o.table) && o.table.every(Array.isArray))) return "table result is malformed";
  if (o.files !== undefined && !(Array.isArray(o.files) && o.files.every((f: any) => f && typeof f.name === "string" && f.bytes instanceof Uint8Array))) return "file result is malformed";
  if (o.preview !== undefined && !(o.preview && typeof o.preview.content === "string" && (o.preview.kind === "svg" || o.preview.kind === "markdown"))) return "preview result is malformed";
  const has = (typeof o.text === "string" && o.text.trim()) || o.table?.length || o.files?.length || o.data !== undefined || o.preview;
  return has ? null : "tool returned an empty result";
}

/** The one execution path for a tool: validate input → run → validate output. Errors are actionable. */
export async function executeTool<C, O>(tool: { id: string; params: string; run: (c: C, p: any) => Promise<O> }, ctx: C, params: Record<string, unknown>): Promise<O> {
  const v = validateParams(parseParamSpec(tool.params), params);
  if (!v.ok) throw new Error(`Invalid input for ${tool.id}: ${v.errors.join("; ")}. Expected ${tool.params}`);
  const out = await tool.run(ctx, v.params);
  const bad = validateToolOut(out);
  if (bad) throw new Error(`${tool.id}: ${bad}`);
  return out;
}
