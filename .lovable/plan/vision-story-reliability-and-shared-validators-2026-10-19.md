# VISION story reliability and shared validators

## Scope

**Plan only.** No application/runtime source changes, commits, model generation, workflow runs or deployments during this review. Only this approval document is written. Preserve GitHub Actions, provider order, workflow routing, OIDC security, private storage and existing chat delivery.

## 1. Current architecture

Default stories/linked prompts route through `src/lib/ai/request-route.ts:18–63` → chat workspace → `/api/jobs` → `jobs/dispatch.server.ts` → `runtime/runtime.server.ts` → `runtime/github.server.ts:24–32`.

Both operations use **prompts.yml**. GitHub `workers/prompts/index.py` aliases `workers/prompts/story/index.py`; `runtime/operations.py:194–208` registers both. Retain one generator. `runtime/runner.py:57–112` claims through OIDC, runs the worker and uploads/reports; `worker_base.py:53–78` supplies operation/path/signature gates.

Cloudflare `auth-gateway/src/runtime.ts:43–125` authenticates runners/stores results; app `runtime/runtime.server.ts:158–198` checks bytes, validates output, saves requested files and chat replies. Its text gate does not establish semantic background/clothing continuity.

Deep chat is separate: `ai/deep/story.ts` already defines canon/manifests/dependencies; `story-run.ts:195–423` orchestrates reviews, repairs and dependent revalidation. Reuse these. Existing story tests mostly use mock models; they do not prove live quality. Previously recorded local Cloudflare edits remain undeployed; deployed parity is unverified.

## 2. Failure diagnosis: confirmed versus unknown

**Run 39190584448**, revision **0521a11c**, 19 October 2026: planning started **02:34:23 UTC**. Three candidates failed at **02:36:52 / 02:37:41 / 02:38:26**, each with a logged background problem beginning `Fixed background requires the same location in every scene`. Failure was reported **02:38:27**; scene writing never started. This accounts for the approximately 255 seconds.

Four Nemotron calls returned successfully, logging 59/89/50/44 seconds. No logged 429, provider error or timeout. The workflow limit is 45 minutes. **The immediate cause was exhausted plan validation, not an observed timeout/outage.**

### Confirmed issues and fixes

- **Repair lacks the rejected plan:** `story/index.py:926–949` sends brief, unchanged blueprint, count and error strings, not prior candidate or exact offending paths. Send candidate plus structured findings and apply scoped patches.
- **Ambiguous identity:** background check `202–215` compares raw room/position strings. Pure-function probes reject equivalent-looking aliases and permit an undeclared bedroom position. Separate canonical room IDs from within-room positions and validate references.
- **Checks mutate evidence:** preprocessing overwrites positions (`930–942`); normalization/validation rewrite state/times/wardrobe (`317–484`). Make validation read-only and semantic repair explicit.
- **Insufficient diagnostics:** logs omit candidate location values/repair responses; failed plans are not checkpointed and runner deletes scratch (`126–127`). Retain bounded private candidates/diffs; log only safe findings/hashes/timing publicly.

Actual room changes, alias confusion, malformed plans, blueprint conflicts and model noncompliance are **hypotheses**. New candidates are revalidated; stale checks are not shown. Scene repair/rollback never ran. My earlier assertion that the background definitely changed was too strong.

Current **252d3cef** adds an outdoor-position phrase check versus failed **0521a11c**, not improved plan repair. Exact historical candidate-level cause cannot be established without the missing outputs.

## 3. Root-level architecture — technical design

Create this Python package at the root of **tkdasofficial/vision-runtime**, outside workers:

```text
validators/
  __init__.py       validate entry point / explicit operation profiles
  contracts.py      versioned constraints, findings, reports
  structural.py     schema, IDs, count/order, references, output shape
  compliance.py     requested fields, languages, word/range restrictions
  continuity.py     canonical rooms/entities/time/props/dependencies
  semantic.py       injected evidence extraction / meaning checks
  repair.py         allowed patches, revalidation and stop decisions
```

Extract existing rules with compatibility wrappers, then remove duplicate implementations. Reuse format/signature/archive helpers; no module per extension or worker.

**Common API:** `validate(artifact, context) → ValidationReport`. Context contains operation/phase, source-backed requirements, canonical plan/state and validator version. Findings carry code, constraint ID, severity, unit/path, expected/observed values, evidence and permitted repair scope. Reports distinguish **passed / failed / unverified**, bound to request/contract and artifact hashes.

Validators never mutate candidates or initiate provider calls. Existing AI workers inject semantic evaluators; generic file workers never acquire AI keys. Objective checks use code. Meaning checks require actual-content evidence, not copied lock metadata. Scores cannot override failed/unverified checks or unresolved flagged scenes.

Cloudflare consumes a shared versioned JSON contract and fixtures through thin TS adapters. Keep existing Deep checks; do not duplicate the Python engine or treat a runner's score as proof.

## 4. Requirement and continuity enforcement

Compile a contract before planning: scene count, requested fields, spoken-word bounds, language, grouping, file opt-in and explicit invariants, each with source clause and scope. Detect conflicting instructions before model calls. Fixed background applies **only when requested**.

For Monkey/Rabbit: 10 ordered scenes; only Visual Prompt and Dialogue; 25–30 spoken words per scene excluding speaker labels/directions; unchanged appearance/clothes and one background; no blueprint or automatic file. Character/theme lists remain inputs, not additional output sections.

Reuse the bible/manifest: stable character/room IDs; separate within-room positions; immutable appearance/background versus mutable props/actions; causal dependencies. When outfits are unspecified, choose and lock once as an assumption. Permit intentional changes when authorized.

Validate plan, visible visual/dialogue content, scene boundaries and exact assembled output. Check temporal/spatial/prop/knowledge transitions. Unknown references fail precisely; never silently overwrite a contradictory room or timeline. Validate single-unit requests too, even without tracked props/positions.

## 5. Repairs, budgets and recovery

1. Preserve candidate/report; explicitly record normalization changes.
2. Repair receives rejected content, exact issues, allowed paths, canon and remaining shared budget. Word failures target dialogue only; spatial failures target affected plan/visual/action fields.
3. Apply validated patches to a copy; reject unauthorized/canon edits. Revalidate local content, whole relevant scope and dependency closure.
4. Commit accepted candidate plus matching report atomically; retain prior approved content on failure. Final assembly is revalidated. No high-score bypass of unresolved flags.
5. Allow at most two content repair rounds per target, subject to one overall deadline/call budget. Stop after two consecutive no-change/identical-failure repairs. Separate provider retries from content correction; honor Retry-After within remaining time.
6. Consume the supplied operation timeout with monotonic deadlines, bounded quota waits/calls and an audit/upload reserve. Existing Python/app/session/workflow limits differ; align effective budgets rather than merely extending all limits.
7. Checkpoints bind owner/request/contract/version/artifact hashes. Current runner-local files do not survive another Actions run. Durable resume must use existing private transport/storage, never public GitHub artifacts/logs, and reload only verified compatible state.
8. Exact-count requests stay all-or-nothing. Partial delivery requires explicit permission, clear missing-scene labels and valid partial content; never call it completed. Failure preserves approved checkpoints and returns an actionable reason.

### Separate orchestration risks, not observed run causes

Protect relay writes against cancellation/timeout races (`auth-gateway/src/runtime.ts:108–125`); enforce deadlines at claim/upload/complete; structurally bound metadata rather than truncate JSON at 20,000 characters; recover jobs interrupted before runtime insertion; reconcile delivery/terminal writes idempotently. Deep calls need cancellation/late-result checks, and saved approvals need validator-version checks. Add fault tests before changing these paths.

## 6. Dependency-ordered implementation

1. Define contracts/shared fixtures and private diagnostic retention.
2. Extract pure checks; add canonical references and explicit normalization.
3. Integrate plan/scene/assembly profiles, scoped repairs, budgets and checkpoints into the existing worker.
4. Add optional shared worker/runner hooks; no story policy in conversion workers.
5. Add TS adapters; reuse Deep state logic; fix runtime count-check early return and format-dependent parsing.
6. Test/harden lifecycle recovery, then authorized staged release and authenticated verification.

## 7. Tests and measurable acceptance

- Unit fixtures: aliases/real room changes, unknown rooms, allowed changes, clothes/identity/time/props/knowledge, missing/duplicate/order errors, 24/25/30/31 spoken words, requested fields/scripts/grouping, conflicts, unavailable checks and high-score flagged failures.
- Repair tests: prior candidate supplied, patches applied, valid fields unchanged, locked edits rejected, dependents revalidated, repeated failures stop, rollback/report hashes match and stale versions invalidate.
- Fake-clock/fault tests: provider errors/late responses, queue/deadline/session expiry, restart integrity, duplicate dispatch/polls, cancellation races, interrupted delivery and allowed partial output. Run affected story, format, security, download and recovery suites; shared fixtures verify Python/TS contract parity.
- **After approval:** three consecutive authenticated Monkey/Rabbit runs through submission → GitHub → Cloudflare → chat → reload. Require 10 ordered scenes, two requested sections each, 25–30 spoken dialogue words each, fixed clothes/background, no blueprint/file, one durable reply and matching artifact/report hashes.
- All mandatory checks pass; each result receives independent evidence-based quality/continuity review **≥90/100**, with rubric and cited failures. Runtime scores/mock tests are not substitutes. Also test single prompt, timed story, permitted background changes, Deep mode and representative non-story operations.
- Record revision, IDs, stage latency and calls. Establish a successful baseline before committing to a speed target.

## 8. Files and workflows in implementation scope

**Runtime:** new `validators/*`, `tests/test_validators.py`, `test_repair.py`, `test_runner_validation.py`, shared contract fixtures; modify `workers/prompts/story/index.py`, `tests/test_prompts.py`, `runtime/worker_base.py`, `runtime/runner.py`, `runtime/operations.py`, relevant AGENTS/docs. Preserve `workers/prompts/index.py` alias and routing registry.

**App:** new `src/lib/validation/contracts.ts`, `runtime-report.ts`, shared fixtures; modify `ai/story-output.ts`, `ai/deep/story.ts`, `story-run.ts`, `runtime/story-validation.ts`, `runtime.server.ts`, `operations.ts`, `auth-gateway/src/runtime.ts`; scoped job dispatch/recovery/delivery changes. Extend existing story/runtime tests; add relay/lifecycle tests. Storage changes require a reviewed migration.

**Workflows:** none new. Preserve existing workflow count and OIDC/secret scope. If budget integration requires settings changes, update `scripts/gen_workflows.py` and generated `.github/workflows/prompts.yml`, not hand-edit generated YAML. No provider migration, credentials changes or UI redesign.

## 9. Risks and approval decisions

Canonical IDs reduce false rejections, but semantic review remains fallible and adds cost/latency. Private records need owner isolation, bounded retention and no public logging. Version changes invalidate old approvals.

Recommended defaults: existing GitHub/models, all-or-nothing exact-count delivery, bounded private diagnostics and staged compatibility rollout. No choice blocks approval. Live tests consume provider resources; workflow runs and app deployment require explicit authorization. **Wait for review and approval before implementation.**
