# Story workflow update — 19 October 2026

## Status
Partial implementation, not a fully functional or live-verified workflow. Deployment and the remaining four generation attempts were authorized. No new attempt was submitted; attempt one remains the failed run documented in story-live-testing-2026-10-19.md.

## Confirmed defects addressed in app source
- Rejected-runtime evidence previously had no private transport. Added a runner-session-authenticated diagnostic write path, restricted to story/prompt operations. The already claimed job determines the owner; client evidence cannot choose ownership.
- Diagnostic storage has SHA-256 hashes, seven-day expiry, a 256 KB entry cap, 64-entry and 4 MB per-job caps enforced in one atomic insert. Repeated matching entries are idempotent. Expired entries are excluded from reads and deleted in bounded batches during writes.
- Explicit diagnostic reads reuse the signed-in, owner-checked job endpoint and independently filter by owner/job/expiry. Generic job results, chat replies and final artifacts do not contain rejected evidence.
- Structured report parsing previously accepted malformed findings and non-string unverified values. These are now rejected; existing failed/unverified approval blocking remains intact.

## Files changed
- auth-gateway/src/runtime.ts
- src/lib/runtime/diagnostics.ts
- src/lib/runtime/diagnostics.server.ts
- src/routes/api/jobs.$jobId.ts
- db/migrations/0002_runtime_diagnostics.sql
- src/lib/validation/contracts.ts
- src/test/runtime-diagnostics.test.ts
- src/test/validation-contracts.test.ts
- AGENTS.md and src/lib/runtime/AGENTS.md
- roadmap.md and this report

## Tests
`bunx vitest run src/test/runtime-diagnostics.test.ts src/test/validation-contracts.test.ts src/test/runtime-story-validation.test.ts src/test/runtime-ops.test.ts src/test/runtime-workflows.test.ts`

34 tests passed in five files. These establish tested parsing, limits and unauthenticated/wrong-operation rejection, not live retention, full persistence integration, or story correctness.

## Deployment blocker and unfinished work
The existing external Cloudflare-hosted application cannot be deployed through this workspace's supported publishing mechanism. Manual application builds and replacing downloaded compiled production modules were not used. User authorization does not remove this platform limitation. The migration was not applied; runtime source was not committed or deployed. No live diagnostic storage is claimed.

Remaining: deploy reviewed source through the external hosting process; apply the migration; add bounded runtime hooks that upload actual rejected plan/scene and extraction/repair evidence before runner cleanup; verify owner isolation, expiry and hashes on the live service; integrate the final shared report acceptance gate; implement/test cross-run checkpoints, interrupted-delivery reconciliation and coordinated lifecycle budgets; then resume the exact prompt within four remaining attempts. Do not send raw evidence to Actions logs or public artifacts.

No original prompt, provider, routing, OIDC policy or story validation rule was changed. No story scores can be calculated from this work. Final chat delivery and reload remain unverified; completion criteria are unmet.