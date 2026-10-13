# Langfuse: comparison

Langfuse is a platform for tracing, evaluating and managing LLM applications. The original capability review cites public documentation read on 2026-10-12 (documentation source commit cb2cebae). The evaluator comparison below runs a public first-party prompt through Haiku. No Langfuse server instance is run.

Every row states its evidence class. Documented advantages are feature descriptions with tests of our implementation only. They do not establish a measured advantage over a running Langfuse instance. A documented gap means the cited documentation does not establish that capability; it does not prove the product lacks it. Limit means the available evidence does not support a comparison.

| Capability | Result | Evidence | Basis | Example | Reproduce |
|---|---|---|---|---|---|
| Dataset items with input, expected output, metadata | documented advantage | documented; our tests only | Documentation review; no instance run. Ours is content-hashed and immutable per version, which their docs do not state. Their optional JSON Schema validation on items is a candidate we lack. | No example recorded in the evidence. | `pnpm exec vitest run packages/cli/test/registry.test.ts --maxWorkers=2`. See comparisons/langfuse/README.md. |
| Dataset versioning and restore | documented advantage | documented; our tests only | Documentation review; no instance run. Ours has a restore report and a per-file diff. A restore procedure is not established by the documentation reviewed. | Pushing the same spec folder twice gives the existing version; restore writes the bytes back. | `pnpm exec vitest run packages/cli/test/registry.test.ts --maxWorkers=2` |
| Dataset from production traces: each draft links to its source trace and observation, and never writes an expectation from the observed reply | documented advantage | documented; our tests only | Documentation review; no instance run. Their docs allow mapping the observed output to `expected_output` and do not stop it. Ours links each draft block to its source observation and writes no expectation from the observed reply. | Trace conv-acme-0001 from packages/adapters/test/traces/fixtures/otel-semconv.json; its two turns link to a100000000000002 and a200000000000002. | `pnpm exec vitest run packages/cli/test/import-traces.test.ts packages/generate/test/drafts/draft.test.ts --maxWorkers=2` |
| LLM-as-judge evaluator | measured shipped default leads by one item on each frozen set | measured prompt procedures at pinned commits | Shipped judge, PR 115 default, measured 2026-10-13: hard 114/120, held-out 116/120, against the template's best 113/120 and 115/120. The intervals overlap. Previous shipped: 111/120 and 109/120. Experimental fact-ledger: 120/120 on both. Easy scores are unmeasured. | Fictional reference facts with near misses, paraphrases, conditions, mixed languages and long distractors. | `python3 comparisons/langfuse/hard/pr115-run.py --cap-usd 0` in the pinned source worktree; instructions below. |
| Judge replay and determinism | documented advantage | documented; our tests only | Documentation review; no instance run. Ours records each judge request in a cassette and replays it. A replay mode is not established by the documentation reviewed. | A cassette recorded from a judge run plays back in a second run with no model call; the verdict set is identical. | `pnpm exec vitest run packages/judges/test/cassette.test.ts --maxWorkers=2` |
| Judge model choice | documented parity | documented; our tests only | Documentation review; no instance run. Comparable: they set the judge model per evaluator in the project, and ours is a client interface. | No example recorded in the evidence. | `pnpm exec vitest run packages/judges/test/clients.test.ts --maxWorkers=2`. See comparisons/langfuse/README.md. |
| Experiment run over a dataset | documented advantage | documented; our tests only | Documentation review; no instance run. Our tests cover campaign-level criteria: each rate gets a Wilson 95 percent interval and the number of runs that would decide it. Known gap: the CLI accepts only the built-in criteria. | Three passing runs of four, against pass-rate 0.7: interval 0.30 to 0.95, undecided. | `pnpm exec vitest run packages/report/test/aggregate.test.ts --maxWorkers=2` |
| Run comparison | limit | documented; our tests only | Documentation review; no instance run. Our tests cover typed comparisons and an HTML view. Their comparison page was not read, so an advantage is not established. | No example recorded in the evidence. | `pnpm exec vitest run packages/report/test/compare.test.ts --maxWorkers=2`. See comparisons/langfuse/README.md. |
| Prompt management: versions | documented parity | documented; our tests only | Documentation review; no instance run. Comparable: their versions are created on change and pinned by number, and ours are content-hashed and diffable. | Pushing the same spec folder twice gives the existing version; restore writes the bytes back. | `pnpm exec vitest run packages/cli/test/registry.test.ts --maxWorkers=2` |
| Prompt labels (for example `production`) | limit | documented; no head-to-head | Documentation review; no instance run. Limit: their docs name labels in a caption only and document no label behaviour, so nothing is compared. | No example recorded in the evidence. | No command: nothing to compare. See comparisons/langfuse/README.md. |
| Prompt linkage to traces and experiments | limit | documented; no head-to-head | Documentation review; no instance run. Limit: their docs document linking to traces, and no linking to experiments was found, so there is no documented behaviour to compare. | No example recorded in the evidence. | No command: nothing to compare. See comparisons/langfuse/README.md. |
| Annotation queues and human scores | documented advantage | documented; our tests only | Documentation review; no instance run. Our tests cover reviewer-against-reviewer match rate and Cohen's kappa. A corresponding measure is not established by the documentation reviewed. At parity on keyboard review: 1 and 2 pick pass or fail, Cmd or Ctrl plus Enter saves, ArrowDown and ArrowUp move between blocks and items, and `?` opens a script-free cheatsheet. | Three items: Ana pass, fail, pass against Ben pass, fail, fail. 2 of 3 items match (67 percent), kappa 0.40. | `pnpm exec vitest run packages/judges/test/queue.test.ts packages/cli/test/queue.test.ts packages/cli/test/queue-view.test.ts --maxWorkers=2`; `npx tsx tools/browser/viewer-journey.ts --out <dir>` |
| Reviewer concordance (Cohen's kappa) | limit | documented; no head-to-head | Documentation review; no instance run. Limit: their queue docs describe no multi-annotator measure, so nothing is compared. Our side is covered by the reviewer-against-reviewer row above. | No example recorded in the evidence. | `pnpm exec vitest run packages/judges/test/queue.test.ts --maxWorkers=2`. See comparisons/langfuse/README.md. |
| Trace and observation schema | documented advantage | documented; our tests only | Documentation review; no instance run. Our tested schema carries input, output, level, usage and cost on each observation, plus subagent nesting, subtree rollup and the slowest path. The documentation review does not establish equivalent Claude Code subagent rollup or slowest-path fields. | Claude Code fixture packages/adapters/test/traces/sessions/claude-code-subagent.jsonl: the branch under sub-a1 has 400 input and 52 output tokens over 5 lines and 4000 ms; the slowest path is sub-u1, sub-a1, sub-u2, sub-a2. | `pnpm exec vitest run packages/adapters/test/traces --maxWorkers=2` |
| CI regression gate | documented advantage | documented; our tests only | Documentation review; no instance run. Our tested gate reports the margin, underpowered criteria and aggregates, and decides parity by a non-inferiority test. The reviewed docs describe a threshold-based CI job. Margin and planning-number behavior is not established by that review. | A failing aggregate turns a passing verdict into AGGREGATE FAILED and exit 1; an incomplete verdict stays incomplete. | `pnpm exec vitest run packages/cli/test/ci.test.ts -t "aggregate|run.sh writes the verdict" --maxWorkers=2` |

## Measured reference correctness

Original run completion: 2026-10-12 for tuning and 2026-10-13 for held-out. PR 115 default completes both frozen sets on 2026-10-13 (Europe/Brussels).

The previous shipped contract remains **111/120 hard and 109/120 held-out**. The **shipped judge, PR 115 default,** measures **114/120 hard and 116/120 held-out** at commit `8195902dd20c84267f85feba268c17868e00dfbe`. [PR 115](https://github.com/achammah/driftbench/pull/115) passes all eight CI checks and is merged into main at `6d0898de`. Its default is now the shipped judge. The measured default is unchanged by the merge apart from the package-scope import rename. The **fact-ledger procedure (not yet the shipped default)** remains a separate comparison method. This follow-up changes comparison evidence, not production judges.

| Procedure | Tuning hard | Frozen held-out | Tuning USD / 100 | Held-out USD / 100 |
|---|---|---|---|---|
| Shipped judge, previous contract | 111/120 | 109/120 | $0.049067 | $0.049150 |
| fact-ledger procedure (not yet the shipped default) | 120/120 | 120/120 | $0.043389 | $0.043523 |
| Template, preregistered 1.0 | 83/120 | 83/120 | $0.052505 | $0.052484 |
| Template, best reported setting 0.5 | 113/120 | 115/120 | $0.052505 | $0.052484 |
| Shipped judge, PR 115 default | 114/120 | 116/120 | $0.055769 | $0.054001 |

| Procedure / threshold | Tuning hard Wilson 95 percent | Held-out Wilson 95 percent |
|---|---|---|
| Shipped judge, previous contract | 86.36% to 96.00% | 84.33% to 94.80% |
| fact-ledger procedure (not yet the shipped default) | 96.90% to 100.00% | 96.90% to 100.00% |
| Template, preregistered 1.0 | 60.42% to 76.73% | 60.42% to 76.73% |
| Template, best reported setting 0.5 | 88.45% to 97.15% | 90.62% to 98.21% |
| Shipped judge, PR 115 default | 89.52% to 97.69% | 91.74% to 98.70% |

The template's 1.0 threshold is preregistered. Its 0.5 threshold is the best of the two reported settings. Both threshold rows share the same calls and cost. The previous shipped contract trails the template's best setting on both sets. PR 115 default scores one more correct item on each set than that setting. The Wilson intervals overlap; this small margin does not establish statistical superiority. The experimental procedure's result is shown separately.

| Set | Raw template at 1.0 | Repaired at 1.0 | Raw template at 0.5 | Repaired at 0.5 | Answers quote-repaired |
|---|---|---|---|---|---|
| Tuning hard | 82/120 | 83/120 | 112/120 | 113/120 | 1 |
| Fresh held-out | 81/120 | 83/120 | 113/120 | 115/120 | 2 |

Strict JSON quote repair is applied to every contestant. It escapes malformed internal quotes without changing scores, labels or reasoning. On tuning case h016, the template correctly returns score 0 but writes unescaped translation quotes. Repair credits that answer. The original unrepaired totals 82/120 and 112/120 remain visible above.

The tuning set has 120 cases, seed 481, with 60 pass and 60 fail labels. The fresh held-out set has 120 cases, seed 7291, with the same balance. Labels and hashes are fixed before its run. All queries, references and replies are disjoint across sets. The generator retains the same 12 families and formulas, with new fictional values and entities. The audit prompt is frozen before the held-out run. Each procedure is called once per held-out case, without tuning or selective retries. This check covers fresh profiles within those families, not new domains or reply templates. The Wilson intervals do not correct for repeated construction patterns or tuning.

Both sides run through the same serial `claude -p --model haiku` path, resolved as `claude-haiku-5-5` in the recordings. The [first-party Correctness version 1 template](https://github.com/langfuse/langfuse/blob/64ba74f971cb59dea6a784953026919b26e31376/worker/src/constants/managed-evaluators.json) is copied verbatim. A server instance is not run. Every prompt, answer, timestamp, usage and cost is retained. The original round costs **$0.34814130 across 720 unique calls**. PR 115 default adds **$0.13172400 across 240 unique calls**, under its separate 1 USD cap. Combined recorded cost is **$0.47986530 across 960 unique calls**.

PR 115 default uses the unchanged criterion with no `answerContract`, `requirements`, `assessment`, `factAudit` or system override. Native `buildPrompt` renders the request and native `parseJudgeValue` validates each decoded ledger and computes its verdict. The same quote repair used by the original rows runs before that parser. All 240 answers also agree with the native CLI parser: no quote repair, unparsed answer or inconclusive result occurs. Each case receives one call, without retries. The ten disagreements are fail predictions against fixed pass labels, involving necessary conditions, place ellipsis, pronouns and shared monthly modifiers.

This follow-up reuses the original frozen held-out set. That set and its prior scores are known before this approved source is measured; it is not a newly generated blind holdout for PR 115. No case, label or scoring rule changes. See `comparisons/langfuse/hard/pr115-results.md` for every disagreement and family score.

Free replay from the repository root:

```sh
python3 comparisons/langfuse/hard/run.py baseline --cap-usd 0
python3 comparisons/langfuse/hard/run.py audit --sides ours-audit --cap-usd 0
python3 comparisons/langfuse/hard/run.py heldout-run --set heldout-cases.json --sides ours-audit,ours,theirs --cap-usd 0
python3 comparisons/langfuse/hard/analyse.py
python3 comparisons/langfuse/hard/analyse.py --set heldout-cases.json
```

For the PR 115 row, replay from an isolated worktree at the pinned commit with this comparison folder copied into it:

```sh
python3 comparisons/langfuse/hard/pr115-run.py --cap-usd 0
python3 comparisons/langfuse/hard/pr115-analyse.py
```

See `comparisons/langfuse/hard/README.md` for frozen hashes, construction, parsing and validation. The original broad local run at `12801e1b` encounters macOS host-wide `lsof` cleanup without a timeout. The follow-up validates 171 targeted judge tests, 20 benchmark tests and nine native contract probes at the approved commit. This comparison does not modify sandbox or production judge source.

## Not compared

- Full source-code audit: not performed. Only the selected evaluator prompt is benchmarked.
- Their enterprise-edition folders: not read.
- A live Langfuse instance: not run. Only the evaluator prompt is measured head-to-head.
- Their run comparison page: not read.
- Claude Code sessions: not established by the documentation reviewed, so subagent nesting has no measured comparison.
- Prompt labels and prompt links to experiments: their docs describe no behaviour to compare.
- Multi-annotator scoring: not in their queue docs.

## Evaluator architecture

Our documented implementation provides a council, calibration and a same-family check. That feature description is separate from the measured correctness of one judge prompt. Each measured procedure uses one Haiku call per case, without council voting. It does not measure either platform's server, integrations, latency, annotation workflow or model choice.
