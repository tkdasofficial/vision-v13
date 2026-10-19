// Browser-side data client. Every request runs on the server, which checks the
// signed-in user and only touches rows they're allowed to.
import { runDataQuery } from "./data.functions";
import { getCurrentUser, signInFn, signOutFn, signUpFn, updateUserFn, verifyEmailFn, resendVerificationFn, requestPasswordResetFn, verifyResetCodeFn, completePasswordResetFn, resetTicketStatusFn } from "./auth.functions";
import type { QueryFilter, QueryResult, QuerySpec } from "./query-types";

type Row = Record<string, any>;
type ChangeEvent = { table: string; eventType: "INSERT" | "UPDATE" | "DELETE"; new: Row; old: Row };
const changeListeners = new Set<(e: ChangeEvent) => void>();
const emit = (e: ChangeEvent) => changeListeners.forEach((fn) => { try { fn(e); } catch (err) { console.error(err); } });

function parseList(v: string) {
  return v.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
}

class QueryBuilder implements PromiseLike<QueryResult> {
  private spec: QuerySpec;
  constructor(table: string) {
    this.spec = { table, action: "select", payload: null, upsertKey: null, filters: [], orders: [], limit: null, rangeFrom: null, rangeTo: null, mode: "many", count: false, head: false, returning: false };
  }
  private f(col: string, op: string, val: any, neg = false) { this.spec.filters.push({ col, op, val, neg } as QueryFilter); return this; }
  select(_cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.spec.action !== "select") this.spec.returning = true;
    if (opts?.count) this.spec.count = true;
    if (opts?.head) this.spec.head = true;
    return this;
  }
  insert(rows: Row | Row[]) { this.spec.action = "insert"; this.spec.payload = rows; return this; }
  update(patch: Row) { this.spec.action = "update"; this.spec.payload = patch; return this; }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) { this.spec.action = "upsert"; this.spec.payload = rows; this.spec.upsertKey = opts?.onConflict ?? null; return this; }
  delete() { this.spec.action = "delete"; return this; }
  eq(c: string, v: any) { return this.f(c, "eq", v); }
  neq(c: string, v: any) { return this.f(c, "neq", v); }
  gt(c: string, v: any) { return this.f(c, "gt", v); }
  gte(c: string, v: any) { return this.f(c, "gte", v); }
  lt(c: string, v: any) { return this.f(c, "lt", v); }
  lte(c: string, v: any) { return this.f(c, "lte", v); }
  in(c: string, v: any[]) { return this.f(c, "in", v); }
  is(c: string, v: any) { return this.f(c, "is", v); }
  like(c: string, v: string) { return this.f(c, "like", v); }
  ilike(c: string, v: string) { return this.f(c, "ilike", v); }
  match(obj: Row) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
  filter(c: string, op: string, v: any) { return this.f(c, op, op === "in" && typeof v === "string" ? parseList(v) : v); }
  not(c: string, op: string, v: any) { return this.f(c, op, op === "in" && typeof v === "string" ? parseList(v) : v, true); }
  order(col: string, opts?: { ascending?: boolean }) { this.spec.orders.push({ col, asc: opts?.ascending ?? true }); return this; }
  limit(n: number) { this.spec.limit = n; return this; }
  range(from: number, to: number) { this.spec.rangeFrom = from; this.spec.rangeTo = to; return this; }
  single() { this.spec.mode = "single"; return this; }
  maybeSingle() { this.spec.mode = "maybe"; return this; }

  private async run(): Promise<QueryResult> {
    const res = await runDataQuery({ data: this.spec });
    if (!res.error && this.spec.action !== "select") {
      const changed = res.rows ?? (Array.isArray(res.data) ? res.data : res.data ? [res.data] : []);
      const type = this.spec.action === "delete" ? "DELETE" : this.spec.action === "update" ? "UPDATE" : "INSERT";
      for (const r of changed) emit({ table: this.spec.table, eventType: type, new: type === "DELETE" ? {} : r, old: type === "DELETE" ? r : {} });
    }
    const { rows: _rows, ...out } = res;
    return out;
  }
  then<A = QueryResult, B = never>(ok?: ((v: QueryResult) => A | PromiseLike<A>) | null, fail?: ((e: any) => B | PromiseLike<B>) | null) {
    return this.run().catch((e: any) => ({ data: null, error: { message: e?.message ?? "Request failed" } })).then(ok, fail);
  }
}

// ── auth ──
type Listener = (event: string, session: any) => void;
const authListeners = new Set<Listener>();
let cached: { user: any } | null | undefined;
let authGen = 0; // bumps on sign-in/out so a slower verification can't overwrite it
const asSession = (user: any) => (user ? { user, access_token: "cookie", token_type: "bearer" } : null);
const notify = (event: string, user: any) => { authGen++; cached = user ? { user } : null; authListeners.forEach((fn) => setTimeout(() => fn(event, asSession(user)), 0)); };
const authErr = (message: string | null) => (message ? { message, name: "AuthError", status: 400 } : null);
const unavailable = (what: string) => ({ data: { user: null, session: null }, error: authErr(`${what} isn't available.`) });

let inflight: Promise<any> | null = null;
// A network hiccup or slow server must never look like "signed out": retry, and
// only treat the user as signed out when the server actually says so.
async function loadUser() {
  if (cached !== undefined) return cached?.user ?? null;
  inflight ??= (async () => {
    const gen = authGen;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await getCurrentUser();
        if (gen !== authGen) return cached?.user ?? null;
        cached = r.user ? { user: r.user } : null;
        return cached?.user ?? null;
      } catch {
        await new Promise((res) => setTimeout(res, 400 * 2 ** i));
      }
    }
    throw new Error("Can't reach the server"); // unknown, not signed out; next check asks again
  })().finally(() => { inflight = null; });
  return inflight;
}

const auth = {
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Row; hints?: { honeypot?: string; elapsedMs?: number } } }) {
    const r = await signUpFn({ data: { email, password, fullName: options?.data?.full_name, hints: options?.hints } });
    if (r.user) notify("SIGNED_IN", r.user);
    return { data: { user: r.user, session: asSession(r.user), needsVerification: r.needsVerification ?? false }, error: authErr(r.error) };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const r = await signInFn({ data: { email, password } });
    if (r.user) notify("SIGNED_IN", r.user);
    return { data: { user: r.user, session: asSession(r.user), needsVerification: r.needsVerification ?? false }, error: authErr(r.error) };
  },
  async verifyEmailCode(email: string, code: string) {
    const r = await verifyEmailFn({ data: { email, code } });
    if (r.user) notify("SIGNED_IN", r.user);
    return { data: { user: r.user }, error: authErr(r.error) };
  },
  async resendVerificationCode(email: string) {
    const r = await resendVerificationFn({ data: { email } });
    return { error: authErr(r.error ?? null) };
  },
  async signInWithOAuth({ provider }: { provider: "google" | "github" }) {
    window.location.href = `/api/oauth/${provider}`;
    return { data: { provider, url: `/api/oauth/${provider}` }, error: null };
  },
  async signOut() { await signOutFn(); notify("SIGNED_OUT", null); return { error: null }; },
  async getSession() {
    try { return { data: { session: asSession(await loadUser()) }, error: null }; }
    catch (e: any) { return { data: { session: null }, error: { message: e?.message ?? "Can't reach the server", name: "AuthRetryableFetchError", status: 0 } }; }
  },
  async getUser() {
    try { return { data: { user: await loadUser() }, error: null }; }
    catch (e: any) { return { data: { user: null }, error: { message: e?.message ?? "Can't reach the server", name: "AuthRetryableFetchError", status: 0 } }; }
  },
  async updateUser(attrs: { password?: string; currentPassword?: string; data?: Row }) {
    const r = await updateUserFn({ data: attrs });
    if (r.user) notify("USER_UPDATED", r.user);
    return { data: { user: r.user }, error: authErr(r.error) };
  },
  onAuthStateChange(cb: Listener) {
    authListeners.add(cb);
    loadUser().then((u) => cb("INITIAL_SESSION", asSession(u)), () => { /* unknown: getSession reports it */ });
    return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
  },
  async resetPasswordForEmail(email: string, _opts?: any) {
    const r = await requestPasswordResetFn({ data: { email } });
    return { data: null, error: authErr(r.error ?? null) };
  },
  async verifyResetCode(email: string, code: string) {
    const r = await verifyResetCodeFn({ data: { email, code } });
    return { data: { ok: r.ok }, error: authErr(r.error) };
  },
  async resetTicketStatus() {
    return resetTicketStatusFn();
  },
  async completePasswordReset(password: string) {
    const r = await completePasswordResetFn({ data: { password } });
    if (r.user) notify("SIGNED_IN", r.user);
    return { data: { user: r.user }, error: authErr(r.error) };
  },
  async signInWithOtp(_o?: any) { return unavailable("Email codes"); },
  async verifyOtp(_o?: any) { return unavailable("Email codes"); },
  mfa: {
    async listFactors() { return { data: { all: [], totp: [], phone: [] }, error: null }; },
    async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1", nextLevel: "aal1", currentAuthenticationMethods: [] }, error: null }; },
    async enroll(_o?: any) { return { data: null, error: authErr("Authenticator apps aren't available yet.") }; },
    async challenge(_o?: any) { return { data: null, error: authErr("Authenticator apps aren't available yet.") }; },
    async verify(_o?: any) { return { data: null, error: authErr("Authenticator apps aren't available yet.") }; },
    async challengeAndVerify(_o?: any) { return { data: null, error: authErr("Authenticator apps aren't available yet.") }; },
    async unenroll(_o?: any) { return { data: null, error: null }; },
  },
};

// ── live updates within this tab ──
function channel(_name: string) {
  const offs: (() => void)[] = [];
  const ch: any = {
    on(_type: string, opts: { table?: string; event?: string; filter?: string }, cb: (p: any) => void) {
      const [fCol, fRest] = (opts.filter ?? "").split("=");
      const fVal = fRest?.replace(/^eq\./, "");
      const fn = (e: ChangeEvent) => {
        if (opts.table && opts.table !== e.table) return;
        if (opts.event && opts.event !== "*" && opts.event !== e.eventType) return;
        const row = e.eventType === "DELETE" ? e.old : e.new;
        if (fCol && fVal !== undefined && String(row[fCol]) !== fVal) return;
        cb({ eventType: e.eventType, new: e.new, old: e.old, table: e.table, schema: "public" });
      };
      changeListeners.add(fn);
      offs.push(() => changeListeners.delete(fn));
      return ch;
    },
    subscribe(cb?: (status: string) => void) { cb?.("SUBSCRIBED"); return ch; },
    unsubscribe() { offs.forEach((o) => o()); return Promise.resolve("ok"); },
  };
  return ch;
}

export const AI_FEATURE_UNAVAILABLE = "This feature isn't available yet. Chat is powered by Cloudflare AI; image and video creation aren't set up.";

export const supabase: any = {
  from: (name: string) => new QueryBuilder(name),
  auth,
  channel,
  removeChannel: (ch: any) => ch?.unsubscribe?.(),
  rpc: async (_fn: string, _args?: any) => ({ data: null, error: null }),
  functions: { invoke: async (_name: string, _opts?: any) => ({ data: null, error: { message: AI_FEATURE_UNAVAILABLE } }) },
};

export type LocalUser = { id: string; email: string; created_at: string; user_metadata: Row; app_metadata: Row };
export type LocalSession = { user: LocalUser; access_token: string; token_type: string };

/** Re-reads the signed-in user from the server (after a sign-in that happened outside `auth`, e.g. Enterprise Login). */
export async function emitAuthRefresh() {
  try {
    const r = await getCurrentUser();
    notify(r.user ? "SIGNED_IN" : "SIGNED_OUT", r.user ?? null);
  } catch { /* ignore */ }
}
