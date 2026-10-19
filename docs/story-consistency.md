# Story consistency upgrade

## Integrated implementation

Continuous scene/chapter/shot requests enter the story branch of the existing Deep pipeline, preserving auth, provider order and detached chat execution. `story.ts` owns Zod contracts, stable canonical IDs, manifest checks, pure state transitions, dependency closure and context gates. `story-run.ts` owns plan validation, individual generation/review, bounded local repair, dependent revalidation and final audit. `story-store.server.ts` stores namespaced owner-scoped JSON records in the existing `deep_executions` table. No migration or deployment was performed.

Only a scene passing both deterministic and semantic checks commits a boundary snapshot. State provenance includes scene ID and quoted evidence. Local fixes revalidate dependents; unchanged valid scenes are not regenerated. Critical errors, missing reviews, malformed JSON and exhausted budgets yield unresolved status, not approval. Approved/rejected versions, repair issues and final audits are saved. Reopening a passed request reuses its result; interrupted runs resume approved scenes when invoked with the same request ID.

## Configuration and limitations

Defaults: two repairs per stage and a 600-second run budget, injectable for tests. Context gating reserves 8,192 output tokens and 2,048 overhead tokens and never cuts essential story facts. GPT-OSS estimates use `o200k_harmony` BPE; other models use a conservative UTF-8 byte upper bound because native tokenizers are unavailable. Published context limits: NVIDIA Super 1M, NVIDIA Nano Omni 262K, Groq GPT-OSS 131,072, Cloudflare GPT-OSS 128,000; unknown adapters use a conservative 32,768. NVIDIA/Cloudflare hard output ceilings were not documented; the existing 8k request allowance is a configured value, not a claimed maximum. Sources: https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b/modelcard ; https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning ; https://console.groq.com/docs/model/openai/gpt-oss-120b ; https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/ . JSON is normalized and schema-checked rather than relying on provider-specific structured-output support. All candidate adapters are budget-gated before dispatch. Actual chosen model/provider are recorded when available; provider-reported usage, exact tokenizer/version and billing costs are not yet available. Full global audit overflow stops honestly; larger loss-aware global-audit windows remain to implement.

Requirements and editable canonical data are persisted as structured JSON; a dedicated blueprint-editing UI and user-triggered scene regeneration UI are not implemented. Missing blocking details produce unresolved planning status rather than an interactive clarification flow. Numbered continuous stories select Deep automatically in Default mode; explicit modes remain unchanged. Arbitrary generic prompt/file stories are not newly rerouted.

## Evaluation rubric

Six separate check categories: story beats/canon; visual/action agreement; dialogue/context; causal/timeline continuity; mandatory instruction coverage; structural schema/IDs. Each reviewed scene and global audit contributes one pass/fail observation per category. Scores are passed checks divided by expected scene checks plus global audit, with null when no checks ran. These are check-coverage/pass ratios, **not measured creative quality or factual accuracy**. Critical unresolved issues always prevent approval irrespective of average score.

Run `bunx vitest run src/test/story-prd.test.ts` for frozen 10/25/50-scene contract fixtures, injected canon/state faults, targeted repair, dependent revalidation, saved-result reuse, provider failures and token overflow. Fixtures use a deterministic mock model; their passes establish orchestration correctness only. Real baseline/upgraded multi-model quality, repair rates, usage/cost and latency comparisons must be recorded against the executing updated Cloudflare backend before claiming PRD completion.

## Preview verification boundary

The unchanged Lovable preview proxies API calls to the existing Cloudflare Worker, not the edited local server routes. The compact UI can be tested here immediately. The story backend edits cannot be claimed live until that Cloudflare runtime is updated through an authorized development path; production deployment remains out of scope.

## Recorded verification — 18 October 2026

- Final full regression suite: 1,458 passed, one skipped across 95 files; automatic preview build OK. Restored live story still contains scene three and no duplicate completion row.
- Signed-in preview: old failed workbook chat shows `Failed after 210s`; tapping reveals `Failed step: Generating` and the saved interruption explanation. Reload restores the same frozen duration. Desktop and 390px layout inspected, no horizontal overflow.
- Saved completed workbook still downloads after sign-in: `Business_Performance_Analysis.xlsx`, valid ZIP, five expected worksheets and three charts.
- A real three-scene story in chat `610b83ea-bdc6-4261-a68f-98192e857e97` showed plain `Planning…`, completed in 96 seconds and produced all three scenes. It still used the existing external story implementation; prose did not demonstrate the new structured scene contracts/audit. This is a compact UI pass, **not** an upgraded story-pipeline end-to-end pass.
- No hosting URL, backend resource, credentials or production deployment changed.

## Scripts and pipeline follow-up

- Deep scene generation now carries prior conversation canon and the full story outline; goal/obstacle/turn, subtext, earned knowledge/recovery and future payoff setup are explicit writing instructions. Empty transition evidence and false review checks cannot approve a scene. Whole-story deterministic checks also run for two-scene stories. Token gating uses UTF-8 byte upper bounds in the generic adapter.
- GitHub runtime `836b2477b1dfa9e9385cc6489de50a75a9e21a29` adds validated causal before/after contracts, per-scene reviews with exact quoted state evidence, the full outline plus validated long-range state, bounded repairs, atomic brief/version-bound checkpoints, numbered document/section checks and a blocking final audit. Explicit counts outside 1–50 now fail rather than silently shorten. Existing models, provider settings and relay-compatible stages are preserved.
- Verification: 1,487 app tests passed, one skipped; 31 runtime story/operation tests passed. GitHub runtime-tests run 39132284655 was in progress at last check. Mock-provider tests verify orchestration, not creative quality. No fresh signed-in generation or quality-score comparison was completed; local Deep activation still needs an authorized Cloudflare update.
- Runtime limitations retained: checkpoints are local to one runner rather than durable across fresh GitHub attempts; workflow dispatch uses mutable main; delivery remains one combined story.md; mode/routing behavior is unchanged. The final runtime audit blocks unresolved stories rather than repairing across scenes. Full-story audit context is not windowed. These are not claimed fixed by this follow-up.