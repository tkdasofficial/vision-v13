# Prompt-generation latency review — 2026-10-19

## Status

Small optimizations deployed to the existing Cloudflare Worker on the user's explicit request after 1,604 tests passed. Deployment version: `ada17d4b-8269-4f88-9192-899c28e4ecbd`; Worker: `https://vision.tusharkantidasofficial.workers.dev`. Deployment completed successfully with the existing D1 databases, story queue and hourly cleanup trigger; deployed `/health` returned HTTP 200. No database or credential changes and no new live generation. There is no usable session for the same account in this workspace. The earlier chat-pasted password has not been retrieved or reused. Fresh browser verification reaches `/auth/login`, not the generation flow.

## Confirmed workflow

| Operation | Evidence / actual configuration | Decision |
| --- | --- | --- |
| Successful queue continuation | `runQueuedStoryJob` sends without a delay; Cloudflare queue read reports `delivery_delay: 0` | Keep; no fixed continuation sleep exists to remove |
| Queue scheduling | Live consumer: batch size 1, concurrency 1, max wait 1,000 ms, retries 3 | Keep; configuration is not a measured per-message scheduling delay |
| Shared-slot contention | Only a waiting job is requeued with 30 seconds delay | Keep; occupied slots are a real prerequisite, and reducing this adds traffic without a measured benefit |
| Transport failure | Consumer retries failed responses/exceptions after 15 seconds | Keep recovery backoff |
| One-call queue runs | One logical completion per run, with durable slot checkpoints | Keep Free-plan CPU safety; no architecture or generation-limit change |
| Provider calls | Existing sequential providers; each cap 150 seconds, no unconditional sleep between fallbacks | Keep providers, settings and timeouts |
| Scene retries | Regenerate once, bounded targeted repairs, retain best scoring candidate, revalidate and checkpoint | Keep all checks and bounds |
| Browser polling | Start/retry previously ran 1,200 ms and 2,000 ms loops simultaneously | Use one 1,200 ms watcher, settle on the first terminal observation, never overlap reads or regress a terminal poll to an older POST response |
| Prompt-slot resume | Previously read every free slot before checking owned slots, even when all required slots were already owned | Read owned slots first; skip capacity scan if sufficient; keep atomic claims for additional slots |
| Accepted-scene resume | Previously rewrote the scene stage even for an already-validated scene | Skip that stage write; retain cancellation checks, record reads and ordered assembly |
| Delivery / cleanup | Runtime finalizes immediately, verifies saved owner-scoped reply before purging workspace | Unchanged; not gated on browser polling |
| GitHub reconciliation | 1.5-second wait is conditional on a GitHub run id | Unrelated to normal Cloudflare stories; unchanged |

## Tests and measurements

- Unchanged full baseline: **109 files, 1,598 passed, 1 skipped**, 69.54 seconds test-suite wall time. This is not generation latency.
- Full post-change suite: **109 files, 1,604 passed, 1 skipped**, 62.01 seconds test-suite wall time; all previously passing tests still pass, with six added tests. Suite wall-time variation does not establish story speed improvement.
- Original targeted baseline: **8 files, 81 passed**.
- Expanded targeted checks after changes: **8 files, 84 passed** (different selection includes slot store and permanent-reply tests). Includes retry recovery, failed delivery retention, concurrent cleanup, cross-user isolation and final validation.
- Added fake-clock tests establish one GET at 1,200 ms, no duplicate GET at 2,000 ms, terminal resolution at 2,400 ms in a two-observation fixture, no timer after completion, no overlapping slow GETs, stale POST safety and concurrent job independence. These are controlled regression timings, not live speed claims.
- Added store test establishes one owner-scoped read and zero global capacity scans when resuming five owned prompt slots.
- Single-call story regression still proves exact provider-call order, unchanged number of runs and no repeated accepted generation, and now checks accepted scene stage is not rewritten on subsequent runs.
- Automatic preview build reports `build OK`.

## Live retest — deployed candidate

Using newly supplied credentials once through normal email/password sign-in, recovered the exact original request via Show More in conversation `c5442f0c-67ba-46bf-8073-30575be16cce`. Both old and new sessions have saved mode `chat`. Submitted the unchanged request once through the composer, with input equality asserted:

> Write a story in 5 scenes about Mira, a young lighthouse keeper with short red hair, a yellow raincoat and black boots, and her grey cat Pip, who rescue a lost fishing boat during a storm. For each scene give a detailed Visual Prompt for image generation and a Dialogue of 25-30 words. Keep the characters, clothing, lighthouse setting and objects consistent across all scenes.

- New job: `623f408c-9430-4080-8215-5e2b5d71393c`; conversation: `025b4f8d-5c63-4fbf-aca8-44e59d92f98f`.
- Observed submission to terminal check: **381.59 seconds (6m22s)**. The browser sampled every five seconds and waited two seconds for terminal rendering, so this is an observed end-to-end upper-bound measurement, not precise provider duration.
- Permanent user message: `17:27:05.231Z`; assistant reply: `17:33:23.719Z`: **378.488 seconds (6m18.5s)** between saved messages. Runtime row creation `17:27:08.076Z` to saved reply: **375.643 seconds**. Runtime `started_at` and `finished_at` are null and cannot support separate queue/compute timing.
- Compared with the previously reported 876-second reference: this observed run is approximately **8m14s shorter (~56%)**. The original runtime job was absent from the timestamp query, and its restored UI showed approximately 909 seconds; therefore 14m36s remains a reported historical reference, not a freshly verified identical-boundary baseline. Provider latency and repair differences can affect this result; the whole reduction cannot be attributed to the small optimizations or promised for future requests.
- Terminal status `completed`; one permanent assistant reply, **9,426 characters**, restored after reload. Five numbered scene sections, each containing Visual Prompt and Dialogue; spoken-word counts **28, 25, 25, 28, 28**, within the requested 25–30 range.
- Workspace `256fd6ed-29bc-4d3f-86fc-630371d23b28`: workflow `succeeded`; cleanup `completed`, no error. Cleanup started `17:33:25.574Z` and completed `17:33:27.904Z`, roughly 4.2 seconds after permanent reply save and before the next hourly cron.
- Read-only D1 checks found zero remaining rows for this job in requests, context, constraints, slots, attempts, validation runs/findings, prompt versions and timing metrics. Only `cleanup_completed` event retained. No manual cleanup or database mutation was performed for verification.
- Final-content caveat: the generated Story also includes duplicated unnumbered Visual Prompt/Dialogue blocks before the five numbered scenes. Scene 2 asks a cat to watch radar/signal the boat, and telescope locations vary. Completion and word counts do not establish independently verified full semantic consistency; no claim of perfect quality or validation regression absence from this one sample.

## Measurement limits

Queue time, per-provider body-complete time, validation, repair, database-operation time and inter-run gaps have not been separately measured before/after in comparable live conditions. Total time for the deployed candidate is measured above; the historical reference is not a controlled paired baseline.

Deployment and one authenticated same-prompt candidate retest are complete. Further causal performance conclusions require a controlled baseline and provider/run-stage timing. No sign-in bypass, session minting through database writes or password reset was used.