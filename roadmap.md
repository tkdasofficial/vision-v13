# Roadmap — Memory, Output Control, Artifacts & Activity Tracking

## Current request — Results stuck on "Executing..."
- [x] Root cause: story jobs ran inside request background time, which Cloudflare cuts short; dead jobs stayed "running" forever.
- [x] Story jobs now run on Cloudflare Queue "vision-story" (worker/entry.mjs consumer, resumable 11-minute runs, heartbeat, stale jobs failed + slots freed); below-90 scene regeneration no longer rejected as "slot unavailable". Deployed with -c wrangler.toml.
- [x] Also fixed: slot setup ran ~100 database calls per step (hit Cloudflare's per-run cap); stalled AI providers now hand over to the next; full story is prose only (was scene-formatted, broke the 5-scene check).
- [ ] Live delivery blocked: account is on Cloudflare Workers Free; queue runs are killed for CPU time while reading long AI replies (exceededCpu). Needs Workers Paid, then add [limits] cpu_ms = 300000 and rerun the test.

## Current request — Diagnose, fix and retest story generation
- [x] Reviewed current runtime: extractor requested room-only values while checks expect within-room spots/state; quote membership incorrectly included injected metadata; spatial repairs rewrote accepted dialogue.
- [x] Activated focused runtime fixes at 67fc129643a784f1f83ce394e07fed43097eba18 with eight regressions. 93 tests passed; three unrelated conversion tests excluded for missing local dependencies. Providers/routing/thresholds unchanged.
- [x] One unchanged-prompt authenticated retest: job 248c2bd5-1302-42f7-adb6-0ad0dededc4a, chat bf27db17-0846-4aaf-80aa-df5ab3d59220, matching GitHub run 39211113962. Failed after 525s at internal audit 89% < required 90%; no output, reload preserves failure. Independent ratings unavailable.
- [ ] Full functional success remains blocked on unavailable rejected-scene/audit evidence and unresolved audit/repair failures; do not claim completion or lower the 90% bar. Two attempts remain in the original five-attempt budget. Further work requires diagnostic activation through external app deployment; no app deployment performed.

## Current request — One full story operation
- [x] Submitted exact recovered Monkey/Rabbit prompt once through authenticated normal chat; SHA256 unchanged. Job 1e2acad2-381d-47f5-bd3a-9fbd4ac9bddd, chat 6484a5bb-0d16-4e54-8571-449d9d0d755c, matching GitHub run 39209884952.
- [x] Failed after 364s: plan first candidate passed, scene checks remained unresolved after two repair rounds (units 4/6/9 flagged; final recorded failures in 4/6). Reload preserves failure; result null, zero artifacts; detailed rejected evidence unavailable. Ratings withheld. Full report: docs/story-one-operation-2026-10-19.md. No retry, source fix or deployment.

## Current request — Authorized end-to-end story workflow completion
- [ ] Activate private evidence retention: app source now has runner-session writes, owner-only explicit reads, SHA-256, seven-day expiry, atomic 64-entry/4 MB job caps and migration; runtime capture/upload and live activation remain blocked on external deployment.
- [ ] Wire shared report acceptance and lifecycle protections: malformed report parsing fixed and tested; production report gating, durable resume and coordinated budgets remain unfinished.
- [ ] Activate corrected backend/runtime — blocked: this workspace does not support deployment of the existing external Cloudflare-hosted app; manual app builds and compiled-package replacement are not performed. Approval received; permission is not the blocker.
- [ ] Continue unchanged Monkey/Rabbit prompt within three remaining attempts — current user authorized exactly one additional operation, now completed and failed; no further retry authorized by this request. Detailed evidence still unavailable.
- [x] Documented partial work and blockers in docs/story-workflow-update-2026-10-19.md; 34 targeted app tests passed. No full-functionality claim.

## Current request — Five-attempt live story improvement loop
- [x] Authenticated and recovered the exact prompt from latest failed chat c142cb99/run 39190584448; composer equality verified before submission.
- [ ] Remaining three attempts: attempt 1 job 072aa505/run 39196017653 failed scene-five prop verification (320s); attempt 2 job 1e2acad2/run 39209884952 failed final scene requirements (364s). Current request authorized one additional operation only; no further retry. Detailed rejected evidence and independent scores remain unavailable.
- [ ] Evidence-confirmed generation fix/regression/retest waits on retained raw evidence; deployment authorization received on 19 October at 05:54 UTC, but external deployment is unsupported here. No blind retry, speculative generation fix, provider change or deployment performed.
- [x] Reported rubric, mandatory gates, identifiers and limitations in docs/story-live-testing-2026-10-19.md. 54 existing story/validator tests passed; reload restores failure, not a story. Completion criteria unmet.

## Current request — Structured output inside Markdown
- [x] Enable callouts, flows, tables and safe links in Markdown boxes and expanded view.
- [x] 88 focused tests passed; automatic build OK. Browser fixture renders callout, table, flow, checklist and math; expanded rows preserved, screenshot inspected, no page errors. No new AI generation or deployment.

## Current request — Repeated prompts in chats
- [x] Signed in and inspected latest six chats: repeated Recent titles are separate test runs, each with one user prompt; newest result has duplicate saved copies and a separate restored job.
- [x] Preserve runtime reply ids and merge saved result/job into one reply; no chat deletion, provider change or deployment.
- [x] 43 targeted regressions passed; automatic build OK. Signed-in newest chat shows one blueprint, one status and one reply footer before/after reload, no page errors; screenshot inspected. Existing separate test chats retained; no deployment.

## Current request — Upgrade story scripts and generation pipelines
- [x] Strengthened conversation canon, full-outline scene context, nonempty transition evidence, blocking review failures and two-scene continuity checks; GitHub runtime adds causal contracts, validated persistent story state, bounded scene repair, original-count rejection and final audit. Models unchanged.
- [x] App regression suite: 1,487 passed, one skipped; runtime story/operations: 31 passed. Updated vision-runtime main at 836b2477b1dfa9e9385cc6489de50a75a9e21a29; GitHub verification pending at run 39132284655.
- [x] Evidence/limits documented in docs/story-consistency.md. No fresh signed-in generation or measured quality scores; Deep local server changes still await authorized Cloudflare activation. Runtime checkpoints remain local to a runner (not cross-run durable), workflow ref remains main, one combined story.md delivery and existing routing retained.

## Current request — GitHub runtime provider selection
- [x] Switched runtime/story.py to NVIDIA nvidia/nemotron-3-super-120b-a12b; retained Groq openai/gpt-oss-120b fallback and verified both GitHub-secret names. Removed optional cap only for the upgraded primary. Runtime repository updated through GitHub API; no Worker deployment or preview URL change.
- [x] 22 runtime regressions passed; GitHub runtime-tests succeeded. Signed-in exact ten-scene request completed in 1123s; GitHub run 39119335115 succeeded. Chat c029bdf4-fbee-4395-a62d-2c72cb60d63c restored after closing/reopening; story.md downloaded twice (155302 bytes, blueprint + exactly scenes 1–10, all ten sections each, Devanagari present in each scene, no Devanagari in visual prompts).
- [x] Verification limits recorded: one combined Markdown download rather than ten separate files; reopening also shows duplicated full-story replies/statuses. Independent scene-copy controls, exhaustive language and narrative continuity compliance are not claimed verified or repaired by this model-selection request.

## Current request — Backend connection and saved-results error handling
- [x] Active Cloudflare version b2d22d24-bd01-4f39-857d-69bb82b1c87c receives 100% traffic (deployed 2026-10-18 05:45:38 UTC). DB/SANDBOX_DB/AI/ASSETS/SMTP bindings, preview origins and required table names verified read-only; no deployment/resource/secret changes this turn.
- [x] Reproduced authenticated HTTP 200 /api/jobs failing with double Brotli decompression. Proxy requests identity encoding and removes decoded encoding headers for JSON/SSE/downloads. Saved-result errors preserve safe server reasons; malformed responses fail explicitly; accepted start/retry polling retains state across transient errors. Six new regressions; full suite 1,475 passed/one skipped; automatic build OK.
- [x] Signed-in jobs/status reads return 200; saved workbook downloads and persists on reload (valid XLSX ZIP, five sheets, 500 sales rows, three charts). Simulated 503 → visible reason/Retry → successful restore. Real calculation 323 saved after reload; closing before a 12-tip answer completed restores Worked for 19s. Exact preview URL unchanged.
- [x] Scope limits: no fresh large story/workbook generation, SMTP delivery, social OAuth, new Drive upload or GitHub dispatch tested. Credential presence is not validity; GITHUB_PAT absent from Worker secret-name listing (runtime configuration unverified). Existing 7-day artifacts, 30-job cap and host lifetime limits remain; no claim every feature is verified.

## Current request — Background workers
- [x] Chat, files and sandbox resolve runtime lifetime before starting work, then register synchronously; SSE start no longer waits for completion before delivering status. Proxy drain is also registered. Missing Worker lifetime fails before acceptance; reply storage failure cannot count as completed; normal/deep error replies persist when storage is available.
- [x] Signed-in task ab607098-01f6-4367-afb2-4f5ed327f545 started, page closed before completion, reopened and reloaded: complete 12-item answer restored with Worked for 63s. 61 targeted tests and full suite 1,470 passed/one skipped; automatic build OK. Preview URL unchanged; no deployment.
- [x] Latest authorized deployment b2d22d24 confirmed active; real task closed before completion and restored after reopening with Worked for 19s on 2026-10-18. Worker lifetime limits still apply; unlimited/very-long completion is not guaranteed by waitUntil.

## Current request — Diagnose unavailable AI providers
- [x] Saved original failure is in story planning (413s). All three existing relays returned 4 with HTTP 200; Groq produced a 10-line planning outline in 3s. Found shared-deadline starvation; repaired fallback reservations and rejected expired partial streams without changing models, caps or total budget. 58 targeted regressions passed; automatic build OK; current-code real planning call succeeded in 31s.
- [ ] Verify complete original story through the executing backend — blocked: preview proxies to unchanged Cloudflare code; retry 049b9ff3 showed Failed after 309s while its server record remained running/planning with no underlying error. No deployment authorized or performed; original full story not claimed complete.

## Current request — Every reply status and actions
- [x] Fixed saved-results 503: development API proxy now resolves the existing public Worker address even after its process variable disappears; non-dev hosts retain the explicit API_ORIGIN requirement. Signed-in jobs read returned 200 and actual saved XLSX downloaded (valid ZIP, five sheets).
- [x] Status stays above normal/saved/file/failed responses; older messages use stored question/reply timestamps when no activity exists. Copy, Speak, Share and three-dot Report/Delete Message/Create Branch appear below every response.
- [x] Signed-in copy/share fallback, speech dispatch, saved report, file branch/reload and deletion/reload verified; original file remains intact. Immediate edits cancel queued old saves to prevent restored deletions. Incognito branches/deletes remain in memory and reports are disabled.
- [x] Phone 360×581 and desktop inspected; no page errors, unchanged preview, no deployment. Full suite 1,464 passed/one skipped before final save-race regression; subsequent 25 targeted tests passed including the added regression; automatic build OK. Full lint remains blocked by 10,374 existing repository-wide errors (mostly formatting); no unrelated cleanup. AI Elements message actions installed; MessageResponse trial broke source-aware table children/currency tests, so MarkdownReply retains its narrowly documented renderer exception.

## Current request — Consistent terminal status position
- [x] Shared compact terminal status across normal/private replies, Deep and completed file jobs; real elapsed time persists even without stage history. Immediate reply save prevents reload dropping duration. Signed-in normal task returned 42 and Worked for 2s, retained after immediate reload; Deep restored Worked for 96s exactly once; failed workbook expanded Failed after 210s → Generating; saved workbook shows one success summary and download. Phone 360×581 inspected with no overflow. Full suite: 1,460 passed, one skipped; automatic build OK. No backend deployment.

## Current request — Story consistency PRD and compact task UI
- [x] Integrated canonical blueprint/scene contracts, dependency closure, evidence-gated state, provider token gates, bounded repair, dependent revalidation, final audit and namespaced saved reports into the existing Deep story branch; no migration/deployment. Configuration/limitations recorded in docs/story-consistency.md.
- [x] Replaced 64px Deep status card and terminal job cards with text; failed elapsed time expands recorded step details. Signed-in old workbook failure: Failed after 210s → Generating; reload preserves duration. Desktop/mobile inspected; saved XLSX download valid with five sheets/three charts. Real three-scene chat shows compact Planning and completes in 96s through current external service.
- [x] Added parser/schema/state/dependency/token/repair/resume/provider regressions and repeatable 10/25/50-scene mock-model benchmarks; no model quality score claimed.
- [ ] Activate/verify updated story backend and real multi-model 10/25/50-scene baseline comparison — blocked: unchanged preview forwards APIs to existing Cloudflare Worker; local server edits are not executing there. Production deployment prohibited; no authorized updated development runtime supplied. Loss-aware global-audit windows, interactive blocking clarifications and provider usage/cost reporting depend on real provider evaluation/capability telemetry; limitations documented, PRD not claimed complete.

## Current request — Restore file results after leaving/reloading
- [x] Signed-in inspection found completed job 9710277d with registered XLSX; mobile button overflow reproduced. Restore requests silently failed without retry; closing during the 800ms question-save delay could lose the question.
- [x] Wrapped named download button, simplified completed XLSX result, retry failed job-list/status reads, merge tasks by id, commit question/session before dispatch. 67 targeted tests passed; automatic build OK.
- [x] Two real workbook jobs completed after leaving/reloading. Final job 4babee21-d162-4ae0-b344-fa37ef0f0f07, chat 468a9294-5e44-4a68-aeeb-fd25953468b5: downloaded 73,215-byte XLSX after reload; fresh login restored question and download. Mobile/desktop inspected, no page errors; ZIP valid, 500 sales rows, five sheets, three charts, 1,745 formulas, zero stored error cells (no recalculation this turn).
- [x] Existing preview URL/backend unchanged; no deployment. Existing seven-day artifact expiry and session-list 30-job cap remain; unlimited Worker lifetime is not guaranteed. This task's leave/reload flow verified, long-duration Worker termination and >30-job chat recovery not claimed.

## Current request — Exact Business Performance Excel verification
- [x] Submitted exact prompt signed-in: chat 901defbe-3d4b-4c39-b755-1fe94d6ba8f5, job 8e861346-fdda-43b1-b66a-51a6f6b4db57 accepted HTTP 200 at 09:15:22 UTC; incorrectly selected 10 records, failed at 09:18:52 as interrupted. Screenshot confirms failed card; main D1 confirms zero artifacts.
- [x] XLSX download/formulas/reconciliation/rankings/chart validation blocked: no file produced. Sandbox D1 remains generating, one chunk/zero completed, attempt 1, last event chunk_started, error null. Executing older external backend lacks the corrected runner/failure persistence; no recorded underlying exception and no current-code Cloudflare development runtime within no-deployment scope. No blind retry or production changes.

## Current request — Uploaded long-output pipeline repair
- [x] Underlying interruption error unavailable: signed-in restored job fb85f20a stops at chunk_started, with sandbox generating/zero completed and no saved error. No blind Excel retry; requires server telemetry from the executing backend.
- [x] Repaired dependency context, chunk retry isolation/atomic claiming, full-plan count/checksum validation, silent outline truncation, unexpected failure persistence, parallel settlement and sandbox background keeper wiring. Seven new regressions; full suite 1435 passed, 1 skipped; automatic build OK.
- [x] Signed-in long-text request saved 1583 words; initial screen showed only first section, reload showed all eight sections. Removed duplicate legacy animation; fresh signed-in chat c29408d6 showed 1816 visible words and section eight without reload, no page errors. Final focused suite: 85 passed; automatic build OK.
- [x] Long file/500-transaction attachment, preview and download blocked: preview forwards to older external Cloudflare service; corrected server code is bypassed. No supported current-code dev backend is configured; production deploy/new pipelines remain out of scope. No resource/schema/secret changes.
- [x] Report actual repairs and test evidence; do not claim end-to-end file completion.

## Current request — Backend-only Cloudflare setup
- [x] Existing standalone auth-gateway covers OAuth/mail/AI/runtime only, not chat memory, XLSX jobs or attachment APIs; both configs target vision, so deploying that gateway would remove required APIs.
- [x] Superseded by preview-only scope: do not deploy, separate hosting, or create a new pipeline. No live service replaced.

## Current request — Existing preview backend verification
- [x] Verified preview proxies APIs to existing vision Worker. Cloudflare read access 200; primary D1 tables and required jobs/artifact/runtime columns present; sandbox six tables present; DB/SANDBOX_DB/AI/SMTP bindings and required secret names present. GitHub runtime workflows accessible and active (200). Drive credentials are Worker secrets, not app_config values.
- [x] Preserved exact preview URL and infrastructure; no migrations, binding changes, credential copies, deployments or new pipelines. Only scope/memory/roadmap updated; no demonstrated missing schema to repair.
- [x] Signed-in preview login and /api/jobs returned 200; original prompt and honest job failure restore after reopening; /api/files returned 200 with one indexed file. Focused regression suite: 119 tests passed in 8 files; automatic build OK.
- [x] Actual Excel job/download: preview chat job fb85f20a-2c74-4410-8847-9b741942a7b4 incorrectly selected 10-record catalog, then became interrupted after stale recovery; zero registered attachments, no download or workbook validation possible. Active external backend remains d74f493f-b746-4086-9da6-175fd37a2f6d. Current local workbook runner is bypassed by API proxy; activating it locally would violate the Cloudflare-only execution rule. Backend update/development runtime unavailable within current no-deployment scope.
- [x] Exact server interruption cause and fresh permanent-memory E2E: captured 296 Worker tail events, all outcome ok with no reported exceptions; POST generation error was not captured, so the underlying cause remains unconfirmed. No blind retry performed. Permanent-memory unit tests passed but fresh UI save/recall not verified in this turn. Resolved: cause was the outdated Worker; fixed by deploying ae7052d8.

## Current request — Resume deployment and prove live Excel delivery
- [x] Deployment audit: dist is ignored/generated, not source; harness output is not available in this sandbox. README/package scripts describe local Vite build then root Wrangler deploy; manual builds and external Cloudflare hosting deployment from this environment are unsupported.
- [x] Deploy latest verified code — external blocker: GitHub vision-v9 main lacks both current workbook branch and delivery guard; GitHub Actions API reports zero app workflows. GitHub PAT authentication returns 200 (CLI absent), so authentication is not the blocker. Runtime workflows are separate and cannot deploy app source under project rules.
- [x] Authenticated live chat/download validation — waits on supported external build/deployment of current source. No new submission or download claimed.
- [x] Demonstrated blocker and checked production: Cloudflare deployment API confirms version d74f493f-b746-4086-9da6-175fd37a2f6d at 100%, created 2026-10-17T07:22:54Z; source read HTTP 200, SHA256 f0d2c7172212540832f2def92db81065e7f4b097f96f1edbc064808c7efbd960, lacks updated business-runner validation marker and Business_Performance_Analysis.xlsx filename. No deployment/mutation or blind retry performed.

## Current request — Fix and verify in-chat Excel delivery
- [x] Reproduced twice with authenticated browser evidence: sign-in/API connection works; deployed catalog path incorrectly generates 10 records; both jobs interrupted. First upload reservation reached verified, but no job_artifacts row exists.
- [x] Preserved workbook writer; repaired false delivery announcement on restored tasks, required completed status plus artifacts, restored fallback Retry control, kept expired workbook contents private. Full suite: 1428 passed, 1 skipped; automatic build OK; authenticated browser confirms Retry available and no false delivery sentence.
- [x] Generate the original workbook through chat and validate its download — blocked by older live service; two attempts failed. Local writer independently verified: 500 rows, five worksheets, three charts, 1745 recalculated formulas, zero errors, 2025 month coverage, source/summary reconciliation, rankings, freeze panes and filters. This is not a chat-download pass.
- [x] Deploy fresh version and repeat live check — no dist/server or dist/client artifacts exist in this sandbox; hosted preview validation does not expose a deployable bundle. Manual builds are prohibited and the supported Publish tool does not update the existing external Worker. Active version remains d74f493f-b746-4086-9da6-175fd37a2f6d; no deployment made.
- [x] Reported evidence and blocker; retries bounded to two real generation attempts, no background retry remains.

## Current request — Repair memory and Excel generation
- [x] Review latest app conversations and identify memory/file-generation failures.
- [x] Repair chat-level and permanent-memory paths with regression tests.
- [x] Repair XLSX generation and long-running execution with regression tests.
- [x] Run regression suite and check automatic build results: 1426 passed, 1 skipped; build OK; independent workbook recalculation: 1745 formulas, zero errors, five-sheet totals reconcile.
- [x] Signed-in chat-only recall after reload, permanent save, new-chat permanent recall and reload persistence verified; temporary permanent test memory removed.
- [x] Activate current fixes on Cloudflare and verify in-chat workbook download: blocked because available dist/server output predates these edits and automatic validation does not refresh that deployment output; live Worker uses the older catalog runner, which interrupted the workbook task. Private file upload also failed. Verified workbook delivered separately in Files.

## Current request — vision-sandbox D1 + long-context generation
- [x] Created "vision-sandbox" D1 (id 4d8098d8-e148-46ea-9e79-b4d35c148c8f), SANDBOX_DB binding in wrangler.toml; schema applied local + remote (6 tables verified live).
- [x] Schema in db/migrations/0001_vision_sandbox.sql: generation_jobs/plans/chunks/context/events/outputs with PKs, FKs, indexes, UNIQUE(job_id, seq), status checks.
- [x] Pipeline in src/lib/sandbox/ (pure generation.ts, store.server.ts, runner.server.ts): outline plan → parallel independent chunks / sequential dependencies → retry failed only → resume from checkpoints → assemble → validate (gaps/order/duplication) → output.
- [x] Endpoints /api/sandbox-generations (+ /$jobId with status/chunks/output/events views and retry/resume/cancel), owner-scoped, same proxy/auth/CSRF conventions as existing routes.
- [x] 17 new tests in src/test/sandbox-generation.test.ts; full suite 1392 passed | 1 skipped; typecheck clean; automatic build OK.
- [x] Verified live Worker has SANDBOX_DB binding; long-context chat jobs use it. Standalone sandbox screen is not requested.

# Roadmap — Memory, Output Control, Artifacts & Activity Tracking

## Current request — Consistent terminal status position
- [ ] Unify normal, Deep and file task outcomes at their existing status position with frozen elapsed seconds; preserve failure details and downloads; verify real chat and regressions.

## Current request — Private Google Drive storage
- [x] Audit output capabilities and storage paths; reconcile 115 canonical writable formats.
- [x] Replace final-file D1 fallback with private Drive; preserve bounded runtime staging and legacy downloads; integrate browser exports.
- [x] Add folder/upload reservations, metadata recovery, authenticated downloads, and bounded legacy migration.
- [x] Automated regressions: 1375 passed, 1 skipped; automatic validation build OK.
- [x] Deploy updated service, initialize Drive folders, migrate legacy finals and verify signed-in downloads — blocked pending deployment authorization; existing Cloudflare Drive settings confirmed present, not changed.

## Current request — Cloudflare-only AI routing
- [x] Audit AI paths; all three live providers responded through Cloudflare (reported outage not reproduced).
- [x] Unify off-Worker text/tools relay with API_ORIGIN; prioritize Worker settings; document Cloudflare-only execution in AGENTS.md.
- [x] Routing regressions: 56 passed; full suite: 1334 passed, 1 skipped; automatic build OK; signed-in preview chat returned 4 and completed in 2s.

## Current request — File-only delivery
- [x] Default all file creation/transformation replies to file delivery without in-file content.
- [x] Show requested contents underneath the delivered file only on explicit opt-in.
- [x] Run delivery regression tests and full suite; verify file/download rendering through automated tests.
- [x] Signed-in preview file-generation check executed twice; both failed on the old live runner, with no attachment registered. Full delivery remains blocked under the current Excel task above.

Spec: user-uploaded VISION memory/output/artifact/activity integration doc (5 tasks, sequential gates).

- [x] Task 1 — Memory integration (chat / permanent / project scopes) + tests
- [x] Task 2 — Output control & response discipline + tests
- [x] Task 3 — Artifact execution & delivery + tests
- [x] Task 4 — Deep-task status & activity history (Title Case labels, collapsed "Worked for Ns") + tests
- [x] Task 5 — Integrated regression suite + real-user E2E with screenshots (completed in earlier turns)
- [x] Final report (completed in earlier turns)

## Task 5 — Real-user verification (final report)
- Login, signup + email verification (MAIL_TOKEN fixed both sides): OK.
- Title Case statuses ("Thinking", "Reasoning"): OK visually.
- PDF of existing story → story.pdf chip, no fake "Writing" status: OK.
- Simple Q&A end-to-end: OK — "2+2" → "Four", with "Worked for 1s" activity row shown.
- BUG (reproducible): "Remember that my favorite color is teal." hangs at "Reasoning" in the UI and never completes; after reload the stuck spinner persists and the reply is missing from chat_messages. Direct fetch of /api/chat with the same payload (mode default, requestId, conversationId) streams fine and fast — so the hang is in the UI/client path for this request kind, not the provider. Not yet fixed.
- Memory recall: unverified because the remember turn never completes (earlier "recall works" was a false positive from composer text).

## Fix: memory chat hang (root cause)
- Root cause: the deployed "vision" Worker predated the permanent-memory feature; the code only existed in the repo. Deployed current code (`bun run build` + `npx wrangler deploy`, version e7780a89).
- Verified E2E: "Remember that my favorite color is teal." completes ("Worked for 5s", no hang), row saved in D1 user_memories, no stuck spinner after reload, recall in a brand-new chat answers "Your favorite color is teal." from memory.
- Added fail-soft test: DB unreachable -> savePermanentMemory null, load [] (11/11 pass).
- Full suite: 1263 passed | 1 skipped; production build OK.
- Remaining known limitation (pre-existing, separate from memory): if the page is reloaded mid-generation, the preview proxy aborts the upstream Worker request, so that reply isn't saved; the reload poll then waits up to 15 min. Memory itself is still saved. On the Worker itself (no proxy) replies run detached and survive reloads.

## Reload during generation — done
- [x] Server records generation stage/outcome (chat_generations); /api/chat-status for reconnect
- [x] Preview proxy keeps generation alive after reload; first message of a new chat now carries its chat id (answer was previously never saved server-side)
- [x] Verified: reload mid-answer → live "Writing" status restored → answer appears once; provider failure → clear note, no spinner

## Current request — Autonomous user-level QA for Long Context Generation (500-record Excel)
- [x] New job type `long_context` routed from chat, driving the vision-sandbox pipeline (plan/chunks in D1, resume on retry)
- [x] Real .xlsx output stage with catalog validation and native business workbook formulas/charts.
- [x] Tests: pure helpers + pipeline with in-memory sandbox double + request routing + xlsx options + invalid-record automatic retries.
- [x] Deploy current Worker — blocked by stale deployment output; do not deploy the old bundle.
- [x] In-chat workbook delivery — live older Worker interrupted the task; independently verified workbook delivered in Files, full signed-in download flow remains unverified.

- Root cause of failed Excel run: Cloudflare Worker ran old code (10-record catalog path). Fixed by packaging in /tmp and `npx wrangler deploy` → version ae7052d8. Re-run job 9710277d completed; 500 rows, 5 sheets, 3 charts, 1,745 formulas, 0 errors after recalculation.

## Current request — Hybrid Execution PRD: story tasks on GitHub Actions runtime
- [x] Add `story_generate` op to vision-runtime (blueprint → N scenes → validate/retry → assemble; NVIDIA Nemotron primary, Groq GPT-OSS 120B fallback via repo secrets; checkpointed progress via relay).
- [x] App: register op in operations.ts; no-input support in runtime.server.ts; story stages in relay; /api/chat routes story requests to runtime dispatch; finalize saves markdown artifact + chat reply.
- [x] github.server.ts reads GITHUB_PAT via getSecret; install GITHUB_PAT Worker secret (value never printed).
- [x] run-job.yml: add story_generate choice + provider secrets env for that op only.
- [x] Tests (app + runtime repo), deploy Worker, push runtime repo, verify real 10-scene story end-to-end — generation/download pass; output-format and duplicate-reply limitations above remain.
- [x] story_generate op added to vision-runtime (blueprint→scenes→validate/retry→assemble; NVIDIA→Groq; checkpointed); pushed to GitHub via API; 20 runtime tests pass.
- [x] App: story_generate registered (no-input), story stages in relay, /api/jobs JSON path, request-route kind "story", chat-workspace dispatches runtime_task; finalize saves Drive artifact + full story as chat reply. GITHUB_PAT installed as Worker secret; github.server.ts uses getSecret. Full suite 1,482 passed.
- [x] Fixed login blocker: security hash key now reads Worker secrets via getSecret with SIGNING_KEY fallback ("Security is not configured" gone; password step verified).
- [x] Worker deployed: 960630d3-beb1-4635-a2dd-6524aadeda51.
- [x] End-to-end completed with updated primary on 2026-10-18: Worked for 1123s, saved account-owned story.md, reopened chat and working download; no full PRD-compliance claim.
- [x] Prompt worker: Nemotron 3 Super only, paced 40 req/min, 4 concurrent (Groq only on outage)
- [ ] Prompt series: strict independent consistency score ≥90% (currently 55–65%) — waiting on user decision about writer model

## Current request — Story runtime and structured inline delivery
- [x] Extract existing generation into workers/prompts/story/index.py without duplicating the pipeline; runtime main updated at 734aa2d.
- [x] Honor story-only, timed stories, scene prompts and requested grouping; hide internal plans and make files opt-in in app finalization.
- [x] Test runtime (56 passed), app routing/delivery/continuity (121 passed), and actual runtime-assembled output through JobCard (6 boxes, structured table/callout, no automatic attachment, no page errors).
- [ ] Verify a newly generated authenticated chat end-to-end using updated Cloudflare finalization — blocked: app backend changes require deployment, not requested this turn. Browser verification used assembled runtime output, not a live AI generation; no accuracy or 90% quality claim.

## Current request — Monkey/Rabbit requirement verification
- [x] Signed in and inspected latest chat e84205fb: independent clarified-requirement score 46/100; all ten dialogues under 25 words, extra output, clothing removal in scene 9 and outdoor background in scene 10.
- [x] Ran exact clarified request in chat 5bb9bed8: old runtime version 4 marked it 100%, but independent review rates it 55/100: four dialogues exceed 30 words, extra sections, changed backgrounds and shirt transfer in scene 10. Model score is not trusted.
- [x] Fixed explicit two-field selection, separate grouping, blocking dialogue ranges, fixed-background plan gates, hidden ledger; GitHub runtime pushed at 3e4f8696. 61 runtime and 106 app regression tests passed, one skipped; automatic build OK.
- [x] Reran through signed-in app at chat 450e0441: failed after 522s; stored error says consistency 85%, below 90%. No approved output to rate; never claimed success.
- [ ] Approved new result and independent ≥90% rating remain unavailable: model output failed bounded checks. App-side prompt/Deep updates are local only; no Cloudflare deployment requested.

## Current request — Deep engine review and quality repair
- [x] Reviewed both paths: wrong-field counting, optional requested fields, forced mysteries, metadata-based evidence, failed-check/score conflicts, unsafe checkpoint acceptance and empty-reply race.
- [x] Repaired genre-aware planning, dialogue-only bounded repair, unverified extraction blocking, actual-evidence checks, failed-check blocking, chosen-checkpoint rollback; added Cloudflare spoken-word/requested-field and delivered-artifact gates, empty-reply-safe persistence.
- [x] Runtime now pushed 252d3cef; 54 runtime tests pass. App regressions: 122 passed, one skipped; automatic build OK. Live signed-in runs: 5da9b835 failed at 366s (32 spoken words), 92574a59 failed at 148s (fixed-background plan), c142cb99 failed at 255s (fixed-background plan). Added validated word-array repairs and room-vs-seat correction; the last run used 0521a11c, latest 252d3cef only adds restored outside-position regression.
- [ ] Approved output and independent ≥90% rating: blocked by model plans still violating fixed background after bounded repairs. No final text was delivered, so quality cannot be rated; no generation is left running. App-side changes remain undeployed (not authorized this turn).

## Approved plan — Shared validators and story reliability
- [ ] Extract reusable root Python validators and integrate plan/scene/final gates with targeted repairs and budgets.
- [ ] Add versioned Cloudflare contract/report checks, fix output counting and protect relay mutations.
- [ ] Test repair application, canonical rooms, lifecycle races and existing story/format regressions.
- [ ] Durable owner-private cross-run checkpoints and interrupted-delivery reconciliation.
- [ ] Deploy and verify three authenticated live passes with independent ≥90% reviews — requires explicit deployment/workflow authorization.
- [x] Story generation runs on Cloudflare (Free plan: one AI call per queue run, verified live 2026-10-19). Was: User requirement (2026-10-19 07:38): story generation must run on Cloudflare, not GitHub Actions. Current pipeline dispatches runtime_task jobs to GitHub runners; moving execution onto Cloudflare is an architecture change needing backend deployment (which this workspace cannot perform). Clarify scope with user before redesign.
