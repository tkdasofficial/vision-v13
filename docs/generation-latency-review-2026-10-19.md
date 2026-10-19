# Prompt-generation latency review — 2026-10-19

## Status

Small local optimizations implemented. No Cloudflare deployment, database changes, credential changes or new live generation. The same account was requested for testing, but there is no usable browser session, test-password environment variable or saved browser session in this workspace. The earlier chat-pasted password has not been retrieved or reused. Signed-out browser verification reaches `/auth/login`, not the generation flow.

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

## Pending live performance verification

Queue time, per-provider body-complete time, polling/network time, validation, repair, database-operation time, inter-run gaps and total five-scene completion time have **not** been measured before/after in comparable live conditions. The historical 14.6-minute run used earlier fixes and is not a valid fresh baseline. No percentage improvement or live generation speed is claimed.

Resume with secure usable access to the same account, run the unchanged five-scene prompt on the current live Worker while recording logs/network timing, and compare with a verified candidate under equivalent conditions. Production deployment remains withheld until the authenticated flow, permanent chat persistence, immediate cleanup and comparative timings can be checked safely. Do not bypass sign-in, mint a first-party session through database writes or reset a password to unblock the test.