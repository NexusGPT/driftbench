# RubricBench dev and frozen confirmation

Measured at 2026-10-13T04:27:28.199Z. Branch: codex/rb-judge. Head: 5756251ccaf16ca9bba12772a37d2f1c651994dd.

Best completed full-dev config: **driftbench-rb-binary-canonical-executed**, **82.3529%**, **$0.167171 per 100 items**.
The 90% target is not met on dev. Tonight confirms the committed frozen design on a previously evaluated split.
Recorded task spend: $4.295809 across 2917 new recorded calls. Aborted calls without a returned cost cannot be metered from this harness.

| Completed variant | Dev items | Game accuracy | Position consistency | USD per 100 items | Unique calls | Unresolved judgments |
|---|---:|---:|---:|---:|---:|---:|
| driftbench-rb-binary-canonical-executed | 357 | 82.3529% | 96.36% | 0.167171 | 357 | 0 |
| driftbench-rb-equal-canonical-executed | 357 | 82.0728% | 96.36% | 0.167171 | 357 | 0 |
| driftbench-rb-equal-canonical | 357 | 81.7927% | 96.64% | 0.163544 | 357 | 0 |
| driftbench-rb-weighted-canonical | 357 | 81.7927% | 96.36% | 0.163544 | 357 | 0 |
| driftbench-rb-holistic-canonical | 357 | 81.7927% | 96.36% | 0.163544 | 357 | 0 |
| driftbench-rb-weighted-canonical-executed | 357 | 81.7927% | 96.08% | 0.167171 | 357 | 0 |
| driftbench-rb-holistic-canonical-executed | 357 | 81.7927% | 96.08% | 0.167171 | 357 | 0 |
| driftbench-rb-binary-canonical | 357 | 81.5126% | 96.64% | 0.163544 | 357 | 0 |
| driftbench-adaptive | 357 | 81.2325% | 91.88% | 0.657528 | 2586 | 0 |
| deepeval | 357 | 80.6723% | 91.60% | 0.274960 | 1071 | 0 |
| promptfoo | 357 | 78.1513% | 80.95% | 0.117368 | 714 | 0 |
| driftbench-rb-quotedcounts | 357 | 77.8711% | 92.44% | 0.423546 | 1227 | 29 |
| driftbench-rb-hardpoint | 357 | 77.0308% | 93.00% | 0.411844 | 1197 | 29 |

## Best config by domain

All completed variants and every dataset domain are in domain-scores.csv beside the result JSON files. The source supplies 16 exact domain labels; their spelling and case stay unchanged.

| Dataset domain | Items | Dev accuracy | Whole judge USD per 100 |
|---|---:|---:|---:|
| code | 78 | 85.8974% | 0.167171 |
| general | 28 | 85.7143% | 0.167171 |
| ifeval | 33 | 87.8788% | 0.167171 |
| mbpp | 5 | 40.0000% | 0.167171 |
| math | 24 | 95.8333% | 0.167171 |
| human-preference | 83 | 68.6747% | 0.167171 |
| stem | 47 | 87.2340% | 0.167171 |
| harmlessness | 13 | 84.6154% | 0.167171 |
| Safety | 12 | 100.0000% | 0.167171 |
| Factuality | 10 | 90.0000% | 0.167171 |
| Focus | 6 | 100.0000% | 0.167171 |
| helpful | 5 | 100.0000% | 0.167171 |
| Precise IF | 9 | 55.5556% | 0.167171 |
| mmlu-pro | 1 | 100.0000% | 0.167171 |
| gpqa | 1 | 100.0000% | 0.167171 |
| Math | 2 | 50.0000% | 0.167171 |

## Earlier test evaluation

The spend ledger for 2026-10-12 records driftbench-adaptive at 82.6% on 790 test pairs, completed at 20:40 local. It records DeepEval at 80.4% on the same split.
Raw completion logs from 12 October also show a completed evaluation over all 1,147 pairs, including the test items. Tonight’s test result is a confirmation on a previously evaluated split.
Cache-only verification reproduces DeepEval at 80.4430% on 790 pairs. This worktree has 686 missing adaptive judgments, so its partial adaptive replay does not verify the ledger’s complete 82.6% result. No model call occurs during the history check.
History evidence and source hashes are saved in prior-test-history.json. Earlier test figures are known before tonight’s dev selection.

## Official frozen confirmation on the previously evaluated test split

Frozen design commit: 76f4f6a6a3acaf105a9f1e0849becf9cf9a3efc5. Freeze recorded at 2026-10-13T02:28:08.534Z; by 04:30 local: yes. Test measured at 2026-10-13T03:58:15.570Z. No design changes follow that freeze.
Stratified sample: 434 of 790 test pairs. All requested cases are evaluated. Missing judgments count as errors: 0.

| Split | Items | Accuracy | 95% interval | USD per 100 items |
|---|---:|---:|---|---:|
| Full dev | 357 | 82.3529% | not reported | 0.167171 |
| Test sample | 434 | 83.4101% | 79.62% to 86.61% | 0.169843 |

95% Wilson interval over item outcomes; shared game entries are not independent

| Test domain | Pairs | Accuracy | Whole judge USD per 100 |
|---|---:|---:|---:|
| code | 99 | 83.8384% | 0.169843 |
| general | 44 | 88.6364% | 0.169843 |
| ifeval | 37 | 83.7838% | 0.169843 |
| stem | 66 | 81.8182% | 0.169843 |
| Factuality | 19 | 84.2105% | 0.169843 |
| math | 26 | 92.3077% | 0.169843 |
| Precise IF | 8 | 87.5000% | 0.169843 |
| harmlessness | 18 | 88.8889% | 0.169843 |
| human-preference | 83 | 74.6988% | 0.169843 |
| Math | 2 | 0.0000% | 0.169843 |
| Safety | 13 | 92.3077% | 0.169843 |
| mmlu-pro | 2 | 100.0000% | 0.169843 |
| Focus | 9 | 100.0000% | 0.169843 |
| helpful | 4 | 100.0000% | 0.169843 |
| mbpp | 4 | 75.0000% | 0.169843 |
| gpqa | 0 | not sampled | 0.169843 |

The original predeclared sample covers 434 pairs: 83.4101%, 95% Wilson 79.62% to 86.61%, USD 0.169843 per 100 items. Its complete results remain in official-test-sample434.json.
The owner then doubles the task cap to USD 16 and authorizes six simultaneous calls. The frozen design evaluates the remaining 356 pairs once. The extension adds 355 recorded calls costing USD 0.617169. No judged sample pair receives a new model call.
The 434-pair sample remains the official headline result; the incomplete extension is reported separately. Test results never select or alter the design.

| Default competitor on the same test items | Accuracy | Missing answers | USD per 100 items |
|---|---:|---:|---:|
| deepeval | 79.9539% | 0 | 0.277680 |
| promptfoo | 79.6083% | 2 | 0.117468 |

Competitors replay their original default prompts on the exact selected test pairs. No new competitor call occurs.

## What changed and why

- Atomic grading records evidence and a score for each expert requirement for both replies. Arithmetic runs in TypeScript, not in the model.
- Binary, equal-weight partial credit, importance-weighted partial credit and holistic aggregation share exact prompts. Their comparisons replay the same answers for free.
- Literal grading restricts evaluation to the rubric. Contrast grading compares degree of fulfillment within each rubric. The contract variant also checks explicit user constraints omitted by the rubric.
- Canonical presentation sorts responses by their content hashes, with no label, item id or domain input. Both caller orders map back to the original replies and share their recorded judgment.
- Repeats and the prompt ensemble are available experimental contestants. Completed results appear above; incomplete attempts appear below. Competitor templates stay unchanged.
- The pointwise engine classifies hard and soft items before seeing replies, validates exact positive quotes, permutes rubric order by sample, and enforces hard satisfaction before weighted soft counts.
- Every five-vote sample uses a content-seeded rubric permutation. The one-sample control keeps the original order. Voting stops only at a mathematical majority that unseen votes cannot change.
- Invalid pointwise grades and hard/soft plans receive one schema retry. The retry preserves the original rubric and response, and its model cost remains recorded.
- Recording files rotate at 8 MiB. Replay reads every numeric shard, and the full-text scan checks all contents. Public-pattern annotations never suppress denylist findings.
- The full-text recording scan loads 33 private terms and finds 0 denylist hits, measured at 2026-10-13T04:27:17.792Z for all. Terms come from the repository common root, local files and environment. They are never copied or printed.
- Code and MBPP snippets run in worktree scratch folders. Python uses supplied examples, JavaScript runs in a VM, C/C++ run when an entry point exists, and SQL uses a scratch SQLite database. A portable Java runtime is stored in the ignored worktree cache; unsupported languages and absent context remain visible unknowns.

The selected configuration uses 1 judgment(s) per prompt and canonical presentation. Its measured score and domain rows above are the evidence for choosing it.
The best configuration converts full-satisfaction grades into Boolean counts. It uses the judge’s named winner when those counts tie.
Against the binary control, the execution variant gains 6 correct pairs and loses 3, a net gain of 3. Exact paired McNemar p=0.5078. This is not a statistically clear improvement. Fresh model draws also differ, so the result does not isolate execution as the cause.
The canonical prototype has 3 rubric-count mismatches and 3 malformed outputs among 357 audited pairs. Its score retains those original judgments. The pointwise engine separately validates every original rubric id. Wrapped expert questions remain one requirement.

Canonical mapping gives the same choice in both input orders. The reported consistency metric still counts ties as inconsistent. Mapping is not evidence that the underlying model is immune to ordering. The two reported games reuse one judgment and are not independent observations.
Cost counts unique recorded prompt keys within a contestant. The legacy costUsd field counts both game requests, including cache hits, and can therefore double-count canonical judgments. uniqueCostUsd is the reproduction cost used here.

## Quote matching and re-grading

The matcher is copied from approved PR 115 commit 8195902dd20c84267f85feba268c17868e00dfbe. The frozen census contains 55 unanchored positive quotes across 41 dev pairs.

| Cumulative validation step | Additional original quotes recovered |
|---|---:|
| Markdown, case, typography, whitespace and ordered omissions | 32 |
| Rendered line separators | 0 |
| Strict JSON-text views | 0 |
| Still unmatched after all shared rules | 23 |

The real-text requirement rejects 0 of the original 55. Remaining failures receive one re-grade; unsupported evidence never becomes a candidate No vote.
Among the original unmatched quotes, 22 have valid re-grades: 20 yes and 2 no. 1 remains unresolved. 23 distinct reply grades are re-graded.
The additional audit finds 52 literal quotes across 42 reply grades that the approved matcher rejects, including partial code fences and inline backticks. Those failures receive the same bounded retry. A follow-up PR is planned; tonight retains the pinned matcher. Re-grading costs remain recorded.
The read-only follow-up fixture contains all 52 quotes with their complete raw candidate replies and no gold labels. It is saved at /Users/assem/Documents/GitHub/driftbench/.worktrees/codex-rb/.cache/rb/normalizer-52-quotes-with-candidates.jsonl.

## Code execution coverage

| Domain | Dev pairs inspected | Pairs with fenced snippets | Snippet groups that ran | Supplied example checks passed |
|---|---:|---:|---:|---:|
| code | 78 | 65 | 12 | 0/0 |
| mbpp | 5 | 5 | 10 | 30/30 |

Both replies pass all supplied MBPP example checks. Their preference decisions still require the formatting, preservation and explanation requirements in the rubric.
No snippets means no executable observation. Unsupported languages, missing libraries, absent context and timeouts remain unknowns. A process error is not automatically a candidate defect. Standard input and command arguments are not synthesized; SQLite does not validate every SQL dialect. Grouped alternative implementations can conflict when run together. The execution journal preserves these limits alongside the actual outputs.

## Reproduce

```sh
pnpm exec tsx examples/judge-benchmarks/src/run.ts --bench rubricbench --model haiku --split dev --contestants driftbench-rb-binary-canonical-executed --concurrency 1 --replay-only
pnpm exec vitest run examples/judge-benchmarks --maxWorkers=2
pnpm exec tsc -p tsconfig.json --noEmit
```

The inference prompts and frozen best config are saved under examples/judge-benchmarks. Raw source dataset rows stay in the ignored local cache. No packages or competitor templates change.

## Partial attempts

A full run must cover all 357 pairs. Unresolved judgment parses count as errors when every model request completes; they remain visible above. Missing recordings from an interrupted run cannot select the best config. A completed contestant remains eligible if a later contestant in the same report stops.

| Report | Requested items | Missing answers across variants | Stop |
|---|---:|---:|---|
| atomic-progress.json | 80 | 588 | partial recording coverage |
| hardpoint-schedule-pilot.json | 357 | 1095 | partial recording coverage |
| hardpoint5-executed-dev.json | 357 | 620 | model call deadline reached |


## Verification after the test extension

Judge source and test files match the frozen commit. The selected config hash remains unchanged. The existing validation passes 62 tests across 12 files and TypeScript checking before the freeze. Only recordings and result artifacts change after it. The latest full-text scan covers every recording shard with 33 private terms and no denylist finding. All shards remain below the 10 MiB guard limit.
