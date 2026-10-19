<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Read src and nested `AGENTS.md` rules before edits. Why: scoped rules apply.
- Markdown boxes reuse rich callouts/flows and unframed tables in both views. Why: preserve structure.
- Files use builder/file-delivery.ts; stories use ai/story-output.ts (explicit fields, opt-in files, durable replies). Preserve job-prefixed ids and merge matching results once. Why: no fake files, lost replies or duplicates.
- Chat attachment Plugins uses one controlled Popover anchored to the composer, selecting via the plugin-chip callback. Why: one anchored picker.
- Credentials live only in Cloudflare Secrets/Variables or its Secrets Store, read at runtime, never in Lovable secrets. Why: Cloudflare is the credential source of truth.
- GitHub CLI is only for `tkdasofficial/vision-runtime` provisioning, workflows, runtime and tests; never app source edits. Why: runtime and app source stay separate.

- Page UIs live in `src/pages/<page>/index.tsx` (Admin stays in `src/views/admin/`), reusable UI in `src/components/<name>/index.tsx` (shadcn `ui/` keeps its flat files); route files only wrap a page. Old URLs are mapped once in `src/lib/legacy-routes.ts` and redirected by thin legacy route files; OAuth callbacks, `/auth/verify` and APIs are never redirected. Page access is decided in `src/lib/route-access.ts` and enforced once by `RouteGuard` in `__root.tsx`; a failed session check means retry, never signed out. Why: one rule set, no flashes or false logouts.
- Navigate via `@/lib/router-compat`, never react-router-dom. Why: simple TanStack calls.
- Worker "vision" deploys only via `bun run deploy` (adds the worker/entry.mjs Queue consumer to nitro's unbundled output; never single-file bundle — exceeds Worker memory). Story/prompt generation runs only as Queue `vision-story` runs (details in `src/lib/AGENTS.md`). Why: request background time is cut short.
- Worker "vision" serves app+gateway; src/server.ts dispatches gateway paths. Off-Worker `/api/*` uses api-proxy.server.ts: API_ORIGIN overrides the shared backend default in every mode; request identity encoding, remove decoded encoding headers. Why: stable preview connection without double decompression; APIs stay on Cloudflare.
- Host-independent frontend: set `AUTH_ORIGIN` to the public origin (else request origin) and add it to the gateway's `ALLOWED_RETURN_ORIGINS`. Why: host anywhere; only the auth origin changes.
- Sign-in is first-party (PBKDF2 hashes, hashed session tokens in D1, HttpOnly cookie, /auth/* pages, two-step reset; details in `src/lib/AGENTS.md`). Why: no third-party auth; tokens never reach browser scripts.
- Text uses `ai/orchestrator.server.ts`: sequential providers, reserved fallback time, expired streams rejected; files emit creation/validation/saving; `components/task-status` freezes elapsed time. Why: healthy fallbacks stay reachable; no partial output or simulated progress.
- Security logic lives in root `security/` (pure TS, store-agnostic, tested in `security/tests`); `src/lib/cloud/security.server.ts` binds it to D1 and the request, and every signup entry point (email + OAuth) calls `evaluateSignup`. Why: one policy for all entry points; decisions stay server-side and testable without D1.
- Enterprise Login state lives server-side in D1 keyed by an HttpOnly attempt cookie; domain ownership is proven only by DNS TXT and OTPs are bound to the attempt (details in `src/lib/AGENTS.md`). Why: the browser never holds verification results.
- Session cookie is SameSite=None + Partitioned with 30-day sliding renewal (refreshed at most daily in getCaller); every sign-in is recorded in D1 login_history with user agent and IP (pruned after 180 days). Why: keeps users signed in, including inside embedded previews; every state-changing endpoint must call assertSameOrigin to replace the CSRF protection Lax used to give.

- Chat/files/sandbox resolve request-scoped waitUntil before starting work and register synchronously; the proxy drains SSE after disconnect. Replies save to chat_messages before success; D1 chat_generations tracks status/heartbeat and /api/chat-status restores without resending. Why: disconnects must not cancel accepted work; storage errors cannot count as success. Host lifetime limits still apply.
- All AI (chat, Deep, jobs, vision, transcription) runs on Cloudflare. Off-Worker APIs proxy to API_ORIGIN; helpers use `aiRelayConfig()` → API_ORIGIN `/ai/:provider` or `/ai/run` (legacy AUTH_GATEWAY_URL fallback), with allowlisted AUTH_ORIGIN. Never use hosting keys or call providers off Worker, even after relay failure. Worker bindings override process values. Why: Cloudflare alone holds AI credentials.

- Restore owned history before references; XLSX uses the formula/chart writer. Stories use ai/story-output.ts for requested fields/spoken-word rules and runtime/story-validation.ts for delivered-artifact gates; evidence and failed checks block approval. Deep retains canon, saved audits and token gates. Why: preserve sources, long-range payoffs and verifiable boundaries.
