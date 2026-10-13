# Hard reference-correctness measurement

This experiment covers the page's one model-judged row, LLM-as-judge evaluator. Its previous outcome is an architecture claim, ahead, with no measured easy scores and no measured set size. The remaining rows compare documented capabilities and tests of our implementation. They do not provide model-judgement datasets to harden.

## Fixed construction and policy

`generate.py` produces exactly 120 fictional cases, with 60 pass and 60 fail cases. Each of 12 families has five positive and five negative cases: nearby numbers, units, negation, entity binding, conditions, exact quantifiers, revisions, mixed languages, fluent unsupported additions, missing facts, long distractors and instruction text in data. Positive and negative counterparts share the same query and reference. The fixed shuffle interleaves labels. No judge receives an ID, label, family or generated error count.

The criterion requires all requested facts and no unsupported factual assertions. Politeness and explicitly quoted hostile instructions are not assertions about the fictional plan. Archived distractors are not requested plan facts. Equivalent paraphrases and exact unit conversions are acceptable. An incomplete but plausible answer fails, even if most facts match. This binary policy is specified before the model calls.

The competitor's template returns continuous correctness. For the exact-correctness policy, only score 1 counts as pass. This threshold is a benchmark choice, not a Langfuse platform default. The scorer also reports a 0.5 threshold using the same answers and no additional calls. Both thresholds are published, with 0.5 labelled as the template's best observed setting. The 1.0 threshold remains the preregistered one. Changing the threshold does not change either template or the constructed truth. Each accuracy has a Wilson 95 percent interval. Overlapping intervals do not establish a statistically reliable advantage.

The hard set is also the authorized tuning set. It is not an unseen test set. Any improvement on it must be labelled as in-sample. Scores do not establish general model or platform superiority.

## Pinned first-party template

The copied template is the first-party `Correctness`, version 1, without a partner field, from `worker/src/constants/managed-evaluators.json` at source commit `64ba74f971cb59dea6a784953026919b26e31376`:

- [Source JSON](https://github.com/langfuse/langfuse/blob/64ba74f971cb59dea6a784953026919b26e31376/worker/src/constants/managed-evaluators.json)
- [Source license](https://github.com/langfuse/langfuse/blob/64ba74f971cb59dea6a784953026919b26e31376/LICENSE)

The selected first-party JSON object and license are vendored. `vendor/correctness.txt` is the template's exact prompt string. `render.mts` fills only its three variables. The common CLI transport supplies a JSON output instruction using the source's score and reasoning definitions. This is a prompt experiment, not a running Langfuse server. No universal default model or threshold is claimed.

Our baseline uses `buildPrompt` directly from `packages/judges/src/prompt.ts`, with a reference-correctness criterion and the same query, reply and trusted reference. It uses one judge, not a council. Both sides use `claude -p --model haiku`, disabled tools and settings, no session persistence and one model call at a time. The resolved model and token usage are recorded in each response.

## Reproduce

Run from the repository root:

```sh
python3 comparisons/langfuse/hard/generate.py
node --import tsx comparisons/langfuse/hard/render.mts
python3 comparisons/langfuse/hard/run.py baseline --cap-usd 0
python3 -m unittest discover -s comparisons/langfuse/hard -p test_run.py
pnpm exec tsc -p comparisons/langfuse/hard/tsconfig.json
pnpm exec vitest run packages/judges/test/prompt.test.ts packages/judges/test/criteria.test.ts --maxWorkers=2
```

A zero cap allows recorded calls only and fails if a requested answer is missing. A paid invocation requires an explicit positive cap, for example `--cap-usd 1.5 --ledger <append-only-spend-ledger.md>`. `calls.jsonl` retains each prompt, answer, cost, timestamp and usage immediately after completion. The experiment-wide budget is 8 USD. Each invocation reserves 0.03 USD before a new call. The fixed deadline in `experiment.json` prevents a resumed run from advancing the authorized stop time. A transport failure without a cost envelope stops the run because its spend is unknown. Paid invocations append start and finish rows to the ledger.

`baseline.json` contains per-case predictions, both threshold interpretations, full-set scores, intervals, call counts and costs. Replay reads the same model answers and recalculates the scores. No label-dependent selection rule, answer-length preference, majority-label default or paid parallelism is used.

## Symmetric parsing and candidate procedure

Every contestant receives the same final-object extraction and strict JSON quote repair, matching `packages/judges/src/contract.ts`. The repair only escapes internal double quotes that cannot terminate a JSON string. It does not change keys, verdicts, scores or reasoning. Raw parsing outcomes are retained alongside repaired totals. On h016, it credits the template's score 0 for a correctly detected negation error; its unrepaired totals 82/120 and 112/120 therefore become 83/120 and 113/120 at the two thresholds. Our baseline remains 111/120. A trailing prose correction on h015 cannot replace its JSON fail verdict.

`ours-audit` uses the measured baseline's errors to inform `audit.txt`. It extracts requested facts, evaluates semantic equivalence in sentence and paragraph context, and lists unsupported assertions separately. Code computes pass only when every fact matches and no unsupported assertions remain. The prompt does not emit a pass/fail label. This is a comparison-script candidate; it is not shipped production behavior. Its measurement uses the same fixed hard set, without changing any labels. It is compared against the template's best 0.5 setting as well as its preregistered 1.0 setting.

After the candidate run, reproduce its measurements without new model calls:

```sh
python3 comparisons/langfuse/hard/run.py audit --sides ours-audit --cap-usd 0
python3 comparisons/langfuse/hard/analyse.py
```

An `analyse.py` run that reproduces the committed numbers leaves `scores.json` and `heldout-scores.json` byte for byte.

The ledger has model-dependent fact extraction. Code validates its shape and rejects empty ledgers, duplicate reference strings and invalid status values. Shape validation does not prove that the model extracted every fact correctly. No unseen-set score is claimed.

## Fresh held-out check

The fact-ledger procedure is frozen before the held-out run. Its label is **fact-ledger procedure (not yet the shipped default)**. The previous shipped contract's hard-set measurement is **111/120**. PR 115 is merged into main at `6d0898de`, and its default is now the shipped judge; this comparison does not modify production judges.

The new seed 7291 selects profiles 48 through 52 using the same construction families, formulas and reply templates. Seed 481 reproduces the original profiles 0 through 4 byte for byte. The held-out set contains 120 new cases with 60 pass and 60 fail labels. None of its queries, references or replies overlaps the tuning set. `manifest.json` fixes its SHA-256 before any held-out call. Its prompts use the same systems and frozen audit text. Each contestant is called once per case, without tuning or selective retries on held-out answers.

This checks transfer to new fictional values and entities within the existing families. It does not test new domains or new semantic templates.

```sh
python3 comparisons/langfuse/hard/generate.py --seed 7291 --output heldout-cases.json
node --import tsx comparisons/langfuse/hard/render.mts heldout-cases.json
python3 comparisons/langfuse/hard/run.py heldout-run --set heldout-cases.json --sides ours-audit,ours,theirs --cap-usd 0
python3 comparisons/langfuse/hard/analyse.py --set heldout-cases.json
pnpm exec biome check --write comparisons/langfuse/hard/heldout-run.json comparisons/langfuse/hard/heldout-scores.json
```

Paid runs use the same invocation cap, shared 8 USD cumulative budget and original deadline. Both sets' results appear side by side in the comparison page and report, including cost per 100 items for each contestant. The two template thresholds share their model calls and costs.

Request digests are stored as `request_sha256`, not credential-like `key` fields. Each digest is computed from the model alias, system prompt and user prompt. No secret-scan rule is relaxed.

## Approved default contract follow-up

`Shipped judge, PR 115 default` is the fifth row: 114/120 hard and 116/120 on the original frozen held-out set. Its source is approved commit `8195902dd20c84267f85feba268c17868e00dfbe`. [PR 115](https://github.com/achammah/driftbench/pull/115) passes all eight CI checks and is merged into main at `6d0898de`. Its default is now the shipped judge. The measured default is unchanged by the merge apart from the package-scope import rename. This comparison changes no production code. The experimental fact-ledger procedure remains separate and is not promoted to the default.

A fresh worktree starts at that exact commit, with the frozen comparison folder copied into it. Native `buildPrompt` uses the original criterion, transcript and trusted-reference input. No contract, requirement, assessment, fact-audit or system override is supplied. The default therefore checks the original unsplit criterion, with evidence and verdict aggregation in the native requirement-ledger parser. The benchmark's unchanged `run.py` decoding and quote repair precede native `parseJudgeValue`.

`pr115-manifest.json` freezes both case files, all 240 rendered prompts, the unchanged repair, runner and native source before the first call. `pr115-calls.jsonl` retains 240 unique requests and full answers, costs and usage. Each case is called once, with no replacement, tuning or selective retry. All answers parse without repair and agree with the native CLI parser. The new round costs $0.13172400: $0.055769 per 100 hard items and $0.054001 per 100 held-out items.

The cap is 1 USD for this round, separate from the original 8 USD experiment. `pr115-run.py` reserves 0.03 USD before each submission, includes prior round charges, and stops on unknown billing. Paid calls require the exact approved HEAD and matching frozen source. A zero cap permits recorded replay only.

The held-out file is reused. Its labels and prior results are already known; this is not a newly generated blind holdout for PR 115. The one-item advantage over the template's best setting on each set does not establish statistical superiority. The ten disagreements are fail predictions against fixed pass labels. `pr115-results.md` shows every disagreement and all family scores.

Run these from the pinned worktree, after copying this comparison folder and installing its locked dependencies:

```sh
node --import tsx comparisons/langfuse/hard/pr115-test.mts
node --import tsx comparisons/langfuse/hard/render.mts hard.json --check
node --import tsx comparisons/langfuse/hard/render.mts heldout-cases.json --check
python3 -m unittest discover -s comparisons/langfuse/hard -p 'test_*.py'
python3 comparisons/langfuse/hard/pr115-run.py --cap-usd 0
python3 comparisons/langfuse/hard/pr115-analyse.py
```

The original renderer now explicitly selects the legacy contract for the old row. Its check mode verifies that every original model input is identical, without rewriting the frozen prompts. The PR 115 renderer selects the default through absent options. Neither renderer sends case IDs or labels to the model.

## Pinned PR 115 replay on a fresh clone

The replay reproduces judge commit `8195902dd20c84267f85feba268c17868e00dfbe`,
not the current production judge. `pinned-judge/` preserves its verbatim source
and transitive judge dependencies. Its manifest records each source hash. The
original `pr115-manifest.json` stays unchanged; its native hashes are checked
against those copies. The original runner and renderer are also archived there
to keep the pre-call harness hashes independently verifiable.

```sh
pnpm install --frozen-lockfile
python3 -m unittest discover -s comparisons/langfuse/hard -p test_pr115.py
python3 comparisons/langfuse/hard/pr115-run.py --cap-usd 0
```

The zero-cap command recomputes every score from recorded answers using that
pinned judge, requires equality with `pr115-scores.json`, and preserves its
original timestamp and bytes. No model calls, credentials, or Git history are
needed. The command prints the judge commit it reproduces.
