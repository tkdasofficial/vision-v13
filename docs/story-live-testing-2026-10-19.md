# VISION story live testing — 19 October 2026

## Outcome

**Not successful. One live attempt was executed; four remain unused.** Testing stopped because the failed run retains neither the rejected scenes nor extraction/repair responses. Repeating generation would not resolve this evidence gap. No application deployment, production configuration change, validator weakening, provider change or unrelated workflow was performed.

## Authentication and original request

Authentication completed through the app's email/password screens. Credentials are not included in this report.

The latest failed Monkey/Rabbit conversation was `c142cb99-9a02-4ad6-90d3-60080881a907`, job `2b21d7b5-18a9-4a45-bc5b-c105659f652c`, GitHub run [39190584448](https://github.com/tkdasofficial/vision-runtime/actions/runs/39190584448). Its saved error was fixed-background plan validation exhaustion. The original prompt was recovered from its expanded user message, not reconstructed from the task description. It specifies ten scenes, 25–30 dialogue words per scene, Visual Prompt and Dialogue, Monkey/Rabbit, School & Homework, unchanged clothing/details and constant background.

Attempt one submitted that recovered text unchanged through the normal chat composer. The composer value was checked for exact equality before submission. UTF-8 prompt SHA256: `76f21c61bc489ba9b83f6a58b42ae9e5ddbdc17bb120c09a63b080f498a1ea3b`.

## Evidence-based scoring rubric

Each criterion scores the fraction of independently inspected applicable units that pass. Meaning-dependent checks require quotations from actual visible content; validator self-scores and metadata locks do not establish correctness. Missing evidence is **unverified**, never a pass or an invented zero. An aggregate is withheld when a weighted category cannot be reviewed.

| Category | Criteria and within-category weights |
| --- | --- |
| Character identity/appearance (I) | Stable identities/species/names 30%; stable appearance 25%; clothing/colors/accessories 35%; consistent cast/pronouns 10% |
| Background/spatial (S) | Same declared background 40%; furniture/decor/lighting unchanged 25%; positions and movements causally consistent 20%; prop placement/ownership continuous 15% |
| Temporal/narrative (T) | Chronological progression 30%; adjacent scenes connect causally 30%; actions/knowledge/object state remain consistent 30%; school/homework theme progression 10% |
| Prompt compliance (P) | Exactly ten ordered scenes 25%; exactly Visual Prompt + Dialogue per scene 25%; 25–30 spoken words per scene, excluding labels/directions 30%; no unwanted sections/blueprint/automatic file 10%; delivered once and reloadable 10% |

**Overall consistency = 0.45 I + 0.35 S + 0.20 P.**

**Overall continuity = 0.50 S + 0.40 T + 0.10 P.**

Both must exceed 80%. Exact scene count, required sections, every dialogue word bound, fixed background and successful delivery/reload independently gate success regardless of aggregate score.

## Attempts

| Attempt | Job / conversation | GitHub run | Outcome | Consistency | Continuity |
| --- | --- | --- | --- | --- | --- |
| 1 | `072aa505-5ced-4bfb-8a11-4ad6081f3dce` / `b7748622-d861-4236-9b62-9459f796dc13` | [39196017653](https://github.com/tkdasofficial/vision-runtime/actions/runs/39196017653) | Failed, 320 seconds | Unverified: no retained story | Unverified: no retained story |
| 2–5 | Not submitted | — | Not run; evidence blocker | — | — |

Attempt one used runtime revision `8a150b830db962ecda4bc0a056b6c792f3038b17`. The Actions log confirms the claimed job ID. Planning passed its first candidate at elapsed 88 seconds with `story.plan` status `passed`, no findings, abbreviated plan hash `f993af8ea02a`. Writing then reached a scene-five continuity failure; two repair rounds also failed. The run completed with GitHub conclusion `failure` and an owner-scoped failed job.

### Mandatory checks

| Check | Attempt-one independent outcome |
| --- | --- |
| Original prompt preserved | Pass: expanded original recovered and composer equality verified |
| Authenticated normal app → backend → Actions path | Pass: app-created job, matching runner claim and runtime revision |
| Exactly ten delivered scenes in order | Fail at delivery; no result. Internal candidate count not independently inspectable |
| Only Visual Prompt + Dialogue per scene | Unverified: rejected scenes unavailable |
| 25–30 spoken words in every scene | Unverified: rejected dialogues unavailable |
| Stable characters/clothing | Unverified: actual text unavailable |
| Fixed background/no unauthorized room | Plan gate passed, but visible-content requirement unverified |
| No blueprint/unwanted sections | Unverified: no delivered text |
| No automatic file | No attachment registered; this alone does not establish story compliance |
| Story delivered and survives reload | Fail: reload restores the failed status, not a story |

## Failure diagnosis

**Confirmed immediate failure:** scene five did not pass independent prop-continuity extraction/comparison after two content repairs. Recorded checks include a paper prop's unverified location, a pencil expected to begin with Rabbit but extracted at a background position, and container/seat positions inconsistent with their expected placement. This is not the prior fixed-background planning failure, nor a recorded timeout. Failure was reported normally.

**Not established:** whether those checks identify genuine prose contradictions, extractor errors, location alias false positives, invalid planning state, or ineffective repair instructions. Logs contain truncated findings but not the actual candidate, full plan, exact evidence quotes or extraction/repair responses. Identical response lengths in two repairs do not prove identical content. No speculative generation/validation fix was made.

**Confirmed diagnostic limitation:** `runtime/runner.py` uploads output only after `worker.run()` returns successfully; `run_prompts()` raises before returning a result when scene checks remain unresolved. The runner's `finally` deletes its temporary work directory. The failure branch of `/runtime/complete` retains only an error truncated to 400 characters. The owner job has null result and zero artifacts. Read-only D1 inspection confirms null output size/chunk count/result and zero staged chunks for this exact run. Full rejected-scene/extractor/repair evidence cannot be recovered through the current transport.

Code inspection also found permissive substring room resolution and legacy finding strings in Actions logs. Neither is established as the cause of this live failure; neither was altered during this task.

## Changes and tests

- No functional source changes, runtime repository commits, new regression tests or deployments were made: the generation root cause is not established from retained evidence.
- Updated `roadmap.md` and added this report only.
- Existing relevant runtime tests: `PYTHONPATH=. python3 -m pytest -q tests/test_validators.py tests/test_prompts.py` — **54 passed**.
- Preview automatic validation: **build OK**, latest inspected entry `2026-10-19T03:41:03Z`.
- Browser evidence: authenticated original failure, exact composer submission, failed attempt after reload. No approved story was displayed.

## Blocker and safe next step

The remaining live loop needs bounded, owner-private retention of rejected plans/scenes, structured findings and extraction/repair evidence, with hashes and explicit retention. The currently executing relay does not expose that facility. Activating a changed Cloudflare diagnostic transport requires explicit deployment authorization, which this request withholds. Do not put raw candidates in Actions logs or public artifacts, mark rejected content as successful output, or bypass the normal pipeline to obtain evidence.

After that evidence facility is authorized and verified, use attempt two with the exact same original prompt, identify the actual text/report discrepancy, add the corresponding regression, and continue within the remaining four-attempt budget. Completion criteria remain unmet.