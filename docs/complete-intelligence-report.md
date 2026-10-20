# VISION intelligence integration — acceptance report

## Status of all ten capabilities

| Capability | Implementation and acceptance status |
|---|---|
| 1. Contextual intelligence | Integrated bounded subject-ranked recall outside the recent conversation window, paired with the original request/answer; relevant context is fenced as data. Lexical relevance, not embeddings or unrestricted semantic recall. |
| 2. Reference resolution | Shared subject/type/version-family selection, explicit ordinals and original/previous/numeric versions; server re-resolves owned sources for file jobs. Tested after unrelated turns. Ambiguous roots ask rather than choosing the latest. |
| 3. Persistent memory | Reuses the previously implemented deterministic commands, independent switches, explicit-priority facts, deferred auto capture and owner-scoped D1 lifecycle. Existing lifecycle/privacy tests passed. Signed-in live cross-chat acceptance remains unverified. |
| 4. Artifact memory/version tracking | Added immutable main-D1 content/hash/source IDs, parent/root links, versions and operation metadata. Committed chat deliverables and verified job outputs are indexed. Original content persists separately from packaging outputs; legacy sources are indexed on explicit use. Reload/module-reset tested on SQLite. Not complete for historical imported artifacts, binary editing, or every runtime-created output path. |
| 5. Task state tracking | Reuses durable jobs, generation statuses and agent checkpoints. Natural-language stop/resume selects owned tasks by subject and uses cancellation/retry. Checkpoints remain recoverable; this is **not suspension mid-operation**, and non-agent retries restart. No new task runner. |
| 6. Intent understanding | Contextual selection feeds existing request, task, requirement and output classifiers. Original content and revisions reach the real pipelines. Bounded deterministic parsing is not unrestricted natural-language understanding. Existing non-Default-mode file-routing behavior preserved. |
| 7. Smart tool calling | Existing tool catalogue, validated parameters, bounded planning/repair and checkpoint execution retained. Planning distinguishes source data from instructions. Single-file tools reject unknown filenames or ambiguous multiple attachments. Verbatim document exports are re-opened and compared before save. |
| 8. Conversation continuity | Saved conversation restoration, bounded recall, explicit source resolution, persisted artifact lineage and job recovery work together. Existing streaming/reload regressions pass. Current history retrieval still has the existing 1,000-message bound. |
| 9. Ambiguity resolution | Competing artifact roots, missing versions/files and competing tasks return clarification/missing outcomes rather than silent selection. Chat reference clarifications bypass provider generation. Clarification-followup understanding remains bounded to existing parser behavior. |
| 10. Multi-step planning/self-verification | Existing max-six-step tool planner, dependent context, per-step verification, repair limits and recovery checkpoints retained. Added original-export verification. Real agent execution tested with a controlled plan; live provider planning and every combination of tools remain unverified. |

## Important changes
- `ai/intelligence.ts`: browser-safe shared artifact/task selection and bounded relevant conversation pairing.
- `ai/intelligence-store.server.ts`: authenticated-owner main-D1 persistence, immutable hashes/lineage, reference preparation and task command adapter; queries have five-second deadlines.
- `db/main-migrations/0002_intelligence_artifacts.sql`: additive/idempotent main **vision D1** table and owner/chat/version indexes, mirrored in `db/schema.sql`. SQLite has no Supabase public-schema grants. No live migration or destructive operations performed.
- Chat: rejects unowned conversation IDs; indexes committed deliverables, recalls relevant earlier topics, and returns confirmed memory/task/clarification outcomes.
- Jobs: checks owned session IDs, re-resolves source before dispatch, stores source identity in input, indexes verified outputs, keeps source snapshots and original reports immutable. The agent fences source in planning and checks exported content before save/checkpoint completion.
- UI: plugin jobs use the shared reference path; private chat explicitly sends incognito. Existing UI/routing/providers/auth preserved.
- Deleted chat-message snapshots are filtered from retrieval by persisted deletion markers. This is visibility filtering, not a destructive purge of the immutable artifact index.

## Executed tests
- Final full suite: **114 files passed, 1,697 tests passed, 1 existing optional upload-fixture test skipped**.
- New `intelligence-integration.test.ts`: **16 tests**. Includes a real generated PDF reopened through the production reader; original coral report survives unrelated questions; actual agent execution verifies/saves/checkpoints the PDF with a controlled planner; immutable retries, previous-version selection after module reload, subject-aware lineage, ambiguity, owner isolation, deletion filtering, additive migration, file selection, relevant recall and task selection.
- Existing task recovery tests verify dependent steps, failed-step skipping, checkpoint readback, hash mismatch recovery and concurrency. Existing memory, streaming, provider, sandbox, story, file and UI regressions passed unchanged.
- Initial test failures were fixed and re-run: preserving generic ordinal references; testing a single-file converter rather than the deliberately all-files extraction tool; excluding question stopwords from subject recall.
- Preview build observer: **build OK** after final code edits.
- Browser: Memory Settings redirects to `/auth/login?redirect=%2Fsettings%2Fmemory`; `/api/memories` and `/api/jobs` return **401** signed out. Screenshot visually confirms login. This proves only signed-out boundaries, not signed-in acceptance.

## Remaining blockers and deployment readiness
**Not definition-of-done complete and not yet approved for production acceptance.** No deployment was authorized or performed. The preview proxies API calls to the older deployed Cloudflare implementation; no fresh same-account session is available. The twelve requested real authenticated end-to-end scenarios therefore have not all been exercised. No credentials were reused from earlier chat, no new provider/service configured, and no user data deleted.

Required before deployment acceptance: review/apply the main-D1 migration to the correct existing database, authorize deployment, use a fresh authorized account session, then run report→unrelated questions→PDF, version/reload, interrupted multi-tool recovery, cross-chat memory changes/off, ambiguous reports and second-owner isolation against the deployed pipeline.

Limits requiring further implementation beyond these safe changes: unrestricted semantic recall; arbitrary binary/image source transformations; complete legacy/runtime artifact ingestion and binary retrieval into tools; durable clarification-choice state for all followups; a distinct paused task state; ordinary chat model-call checkpoint resume; preservation/selection beyond the existing bounded history/record windows. These are not represented as finished or silently mocked.