# Reader-first judge study

This separate, explicitly length-aware configuration is exploratory. It never replaces the default judge.

The owner asks for a longer answer unless it fails structure, economy, directness, context-free clarity or simplicity. Machine features are measured first, followed by the five-item rubric on both complete replies in both orders. Code pools criterion scores after remapping the swapped order. Scores are fulfillment, not confidence. Exact evidence quotes are validated against both replies. Invalid evidence prevents a judge override and is reported as a length fallback.

## Initial DEV plan

Only the fixed 90-pair DEV split is used for tuning. Two sequential calls per pair; six concurrent pair workers after the owner raises the concurrency limit. No automatic retries. A returned error stops the run and reserves its per-call limit. The total authorization is USD 20.00. Raw responses, recipe cost and fresh spend are retained separately.

Length uses English whitespace words or Chinese Han characters. The machine-only ablation flips the longer choice when its risk count exceeds the shorter reply by `featureMargin`. The combined variant flips only when both ballots validate, the pooled five-score advantage exceeds `judgeMargin`, and at least `minFailures` criteria have a longer score <=2, shorter score >=3, and a matching machine flag present only in the longer reply. Equal-length replies tie. Both games use the pooled decision; they are not independent votes.

Initial thresholds: judgeMargin 4, featureMargin 2, minFailures 2. DEV-only search is predeclared over judgeMargin [2,3,4,5,6,8,10], featureMargin [1,2,3,4,5], minFailures [1,2,3]. Select the maximum DEV combined score, then fewer overrides, then larger judgeMargin, then larger minFailures. The featureMargin is selected independently for its ablation, with larger margin breaking ties. Report every combination, including losses. Commit the selected rule before the final full DEV replay. If it scores at least 142/180, write and commit a source-hash freeze, then run TEST once over all 173 pairs, 346 games. TEST may never choose or change thresholds. This TEST split was evaluated by earlier studies; it is confirmation, not a pristine holdout.

## Reproduction

Use worktree-local `TMPDIR` and `DRIFTBENCH_BENCH_CACHE` with `node --import tsx comparisons/reader-first/src/study.ts --phase explore`. `--phase final-dev` only replays exact recordings. `--phase test` requires the committed freeze hashes and creates an exclusive run receipt before reading the split. A second TEST invocation requires an incomplete first run and the explicit resume flag. Raw candidate text is loaded from the public dataset, never copied from a judge summary.

Harness source: `research/opus-wp` at af25ea12, `examples/judge-benchmarks/src/{data,call}.ts`. The call harness uses one attempt here so unreturned retries cannot silently spend. The default judging code is imported without edits.

## Deadline update

The owner raises concurrency to six and the budget to USD 20.00. Last new call: 2026-10-13 06:39 Brussels. Commit, push and report deadline: 06:42. Two in-flight calls from the original two-worker process are stopped and reserve USD 0.20. Returned recordings replay without spending again. TEST starts when frozen DEV passes. Incomplete results at cutoff are labeled partial, as authorized by the owner.

The owner authorizes TEST after 144/180 DEV, with six calls at a time and no new calls after 06:39 Brussels. An interrupted TEST is partial and resumes from the same frozen source hashes and cached calls after the outage. Resume requires `--resume --call-deadline <authorized ISO timestamp>`; a completed TEST cannot run again. The 22 of 90 invalid-evidence DEV pairs use length fallback.

## Consistent contact redaction

One approved benchmark contact is replaced with `support@example.com` in loaded candidates, recorded evidence and result exports. The loader scopes this replacement by item ID and the original address hash because other items contain contacts that must stay unchanged.

Exact candidate-substring validation applies without a bypass. Both affected prompt keys and the corresponding exported pair keys are recomputed. Scores remain unchanged. See [the redaction note](recordings/REDACTION.md) for provenance and replay verification. Historical freeze receipts retain the source hashes measured during the original study.
