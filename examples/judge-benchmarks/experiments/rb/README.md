# RubricBench dev experiments

These experiments use the existing deterministic dev split. They do not change competitor templates. One official confirmation follows a committed design freeze. The test split was previously evaluated on 12 October; prior-test-history.json records that history and its source hashes.

## Results

- `best-config.json` freezes the best completed full-dev configuration and its measured reproduction cost.
- `domain-scores.csv` contains all completed variants and every original dataset domain. Its cost column is the whole judge's cost per 100 items, not a separate domain cost.
- Run JSON files contain the harness summaries, actual new spend, unique prompt cost and missing-answer counts. Only a completed contestant on all 357 dev pairs can select the best configuration.
- `campaign-state.json` identifies the active sequential run. `campaign-stop.json` records its stopping reason.
- `code-coverage.json` records an observation for every dev code and MBPP pair, including explicit unknowns. `execution.jsonl` preserves exact execution observations keyed by the question, both candidate contents and executor version.

The source dataset stays in the ignored cache. Execution observations do not claim that unsupported code, missing context or an absent library is a candidate defect. Standard input and arguments are not synthesized. SQLite does not validate every SQL dialect. Adjacent alternative implementations may conflict when grouped.

## Judge designs

Atomic pairwise variants grade each expert requirement for both replies and compare the grades in TypeScript. Their aggregation ablations share the same model recordings.

The pointwise engine first classifies hard and soft requirements from the question and rubric, without seeing either reply. It then checks each reply alone. A positive Boolean requires a quote matched against that reply or its execution evidence by the approved PR 115 rules at 8195902dd20c84267f85feba268c17868e00dfbe. Invalid evidence is an unresolved grader result, never a candidate No vote. A bounded retry re-grades a failed response once. Rubric items keep their original ids while every five-vote sample permutes their presentation order.

Hard-item comparison runs in code. Central hard requirements take priority over supporting hard requirements, which take priority over presentation hard requirements. Soft successes never offset a hard deficit. Weighted soft counts decide only when hard levels tie. The quoted-count ablation instead compares unweighted Boolean counts.

The five-vote variants compute a majority for each individual requirement before comparing replies. They stop a reply's sampling early only when every Boolean already has three matching votes. This produces the same result as completing the remaining votes. An unresolved tie gets a direct named winner with an identifying quote. No pass/fail-to-winner mapping is used.

Canonical pairwise variants sort replies by content hash and map the resulting winner back to both input orders. The two scored games share that judgment. This guarantees mapping consistency, not immunity to the model's own presentation bias.

## Reproduction

Run from the repository root. Replay uses the committed model recordings and, for executed variants, the versioned execution journal. Set `DRIFTBENCH_BENCH_CACHE` to a local cache for the public dataset.

```sh
pnpm exec tsx examples/judge-benchmarks/src/run.ts --bench rubricbench --model haiku --split dev --contestants driftbench-rb-equal-canonical --concurrency 1 --replay-only
pnpm exec tsx examples/judge-benchmarks/src/rubric-report.ts /path/to/authorized/report.md
pnpm exec vitest run examples/judge-benchmarks --maxWorkers=2
pnpm exec tsc -p tsconfig.json --noEmit
```

Cost counts each unique recorded prompt once per contestant. It includes planning, grading and tie-breaking. Summing contestant reproduction costs overstates experiment spend when variants share prompts. The spend ledger records actual new calls separately. Aborted calls without a returned cost remain unmetered by this harness.

## Official night schedule

The design freezes by 04:30 Europe/Brussels on 2026-10-13. Its commit and the configuration hash are recorded in `frozen-design.json`. After that freeze, `rubric-official-test.ts` makes exactly one confirmation attempt on the previously evaluated test split. It refuses a changed source or configuration and creates its start marker exclusively.

The script declares a proportional stratified fallback before judging. If the observed throughput projects that the full test set exceeds the 06:30 deadline, it judges that sample directly. Otherwise it attempts the full set with the fallback first. A deadline overrun reports the predeclared subset from cache, with no second model attempt. The result records the sample size, domain allocation, throughput projection, cost and a 95% Wilson interval over item outcomes. Both game entries share the same winner, so they do not double the interval sample size. An incomplete attempt does not receive a complete-result interval.

Competitors replay their existing default judgments on the exact same selected items. No additional competitor model call occurs. Test results never choose or change the frozen design.

Wrapped expert questions stay together as one atomic requirement. The dev audit distinguishes extra-criterion outputs from malformed model outputs.

The public-recording helper scans complete JSONL text even beyond the tree guard byte limit. Its `--bench rubricbench` option confines annotations to these recordings. Denylist findings are never marked.

An ignored private denylist does not copy into a new worktree. The helper therefore reads local and environment terms plus the list at the repository common root, resolved through Git. It never copies or prints those terms.

Recording files rotate at 8 MiB. Replay reads legacy files and every numeric shard in numeric order. Shard migration verifies that concatenated output bytes equal the original before removing the legacy file.

quote-recovery.json records the cumulative recovery of the original 55 unmatched quotes. The approved matcher also rejects 52 previously accepted literal quotes across 42 reply grades. normalizer-extra-failures.json records that extra failure population without candidate text. Tonight retains the approved matcher and uses the bounded retry; the proposed monotonic literal-match fix is a separate change.
