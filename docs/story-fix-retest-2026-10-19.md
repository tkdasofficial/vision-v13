# Story failure fixes and retest — 19 October 2026

## Outcome

Partial fixes activated; full workflow **not successful**. One retest ran through normal authenticated chat, runtime dispatch, scene checks, repairs and audit. It failed after 525s, with no approved reply or artifacts. Reload restored the failed status.

Job: `248c2bd5-1302-42f7-adb6-0ad0dededc4a`. Conversation: `bf27db17-0846-4aaf-80aa-df5ab3d59220`. Matching [GitHub run 39211113962](https://github.com/tkdasofficial/vision-runtime/actions/runs/39211113962) claimed this job and ran revision `67fc129643a784f1f83ce394e07fed43097eba18`, then concluded failure.

Original prompt recovered and submitted unchanged, exact composer equality asserted; SHA256 `76f21c61bc489ba9b83f6a58b42ae9e5ddbdc17bb120c09a63b080f498a1ea3b`. No credentials are recorded here.

## Confirmed implementation defects addressed

- Extractor schema requested room-only character locations and holder-only object values, while comparison requires precise within-room spots and state qualifiers. Schema now explicitly preserves full labels supported by actual visible text; missing/wrong spots and state still fail.
- Movement quote membership previously searched stamped text, although the extractor receives metadata-stripped prose. Quotes now must occur in that same visible prose; injected canon cannot supply event evidence.
- Spatial repairs previously regenerated the entire unit, including accepted dialogue. Spatial-only repairs for the two-field request now splice only Visual Prompt; extra-section replies are rejected and dialogue stays byte-for-byte unchanged.
- Writer instructions explicitly request initial placement, actual movement/transfer, final position/state in visible prose. Extraction budget now scales within a bounded cap; malformed extraction shapes return unverified rather than crashing.

No blanket plural normalization or removal of position/state detail was added. Provider models, routing, OIDC policy, workflow count, repair limits and 90% audit threshold were preserved. Checkpoint version advanced to invalidate incompatible old state.

## Runtime files and tests

Changed `workers/prompts/story/index.py`, added `tests/test_story_spatial_repair.py`, updated root `AGENTS.md`. GitHub API update was atomic, non-force, and refused stale parent revisions.

Eight new regressions cover schema detail, exact-position acceptance versus room-only rejection, wrong holder/missing transition quote, metadata-only quote rejection, malformed extraction, state/spot preservation, dialogue-preserving visual splice and scoped repair request.

`PYTHONPATH=. python -m pytest -q tests/test_story_spatial_repair.py tests/test_prompts.py tests/test_validators.py tests/test_workers.py -k 'not real_output'`: **93 passed, 3 deselected**. The three unrelated real conversion tests need Pillow, PyArrow and FontTools absent from the isolated test environment; they initially failed for these missing dependencies, not story assertions. No claim of a full all-format test pass.

## Retest evidence

Planning first candidate passed at 06:40:51 UTC. Initial scene checks flagged units 4/9 for extracted state-label differences. Two bounded repairs resolved the blocking scene-gate stage sufficiently to enter windowed audit.

Audit window scores were `[100,89,100]`, then `[85,100,85]`, then `[60,100,89]`. The existing best-candidate selection retained the earlier 89 score; the final job error correctly rejected it below the unchanged 90 threshold.

During audit-driven whole-unit repairs, rejected candidates for scene 6 had 44 dialogue words and scene 4 had 77, above the requested 25–30 range. Those candidate checks failed and were not accepted. These audit-driven repairs are broader than the new spatial-only repair path. The audit's exact semantic findings and rejected candidate prose remain unavailable through the live owner endpoint, so their underlying content causes cannot be established from scores and flags alone.

The live run's internal 89% score is **not** an independent measured consistency or continuity rating. No delivered story exists to review; both independent ratings remain unverified.

## Mandatory results and blockers

- Sign-in, unchanged prompt, normal dispatch, matching runner revision and persisted failure: verified.
- Planning and initial scene-stage passage: runtime-reported, not independent final-content approval.
- Final audit/approval and story delivery: failed.
- Exactly ten delivered scenes, required fields, dialogue counts, fixed background, clothing and narrative continuity: independently unverified without output.
- No approved output or attachment; reload preserves failure, not a story.

No second retest, app deployment, database/configuration changes or validation weakening occurred. Full operation remains incomplete. Further evidence-confirmed repair requires live private diagnostic capture/read activation and actual rejected audit/scene evidence; this external app deployment remains unavailable through the workspace's supported publishing process. Two attempts remain within the original five-attempt budget; none is running.