# LongJudge verify: prior TEST exposure provenance

Observed: 2026-10-13T00:38:23.375085+00:00. Local zone: Europe/Brussels. Model calls: 0. New predictions: 0.

Prior TEST exposure is established on 12 October 2026. Three archived raw outputs score 221 TEST items. The earlier unsplit run also evaluates all 316 items, including this same 221-item TEST partition. Tonight therefore constitutes confirmation on a previously evaluated split. This finding does not prove that any tuning used TEST labels.

## Raw historical TEST runs

Capture paths below are relative to the archived `judge-benchmarks` worktree. Each metric uses official labels. Costs per 100 are derived from the printed total contestant cost, not the new-spend footer. Printed costs limit precision.

| Trial | Contestant | Items | Official score | Balanced score | Total recorded cost USD | Derived cost per 100 USD | New spend USD | Missing |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A | driftbench-reference | 221 | 73.3 | 69.1 | 0.7470 | 0.338009 | 0.7441 | 0 |
| B | driftbench-reference3 | 221 | 74.2 | 68.9 | 1.4636 | 0.662262 | 0.7166 | 0 |
| C | driftbench-adaptive | 221 | 73.8 | 68.6 | 1.4874 | 0.673032 | 0.1961 | 0 |

### Trial A: `_captures/jb/testA-v.out`

SHA-256: `5fea79a6b719dc8ca703c2b75d64ed88ac49a311ac52d19b322ca77f45f07309`. Last filesystem write: `2026-10-12T15:00:20.789292+02:00`.

Verbatim complete raw output:

```text
longjudge-verify on haiku: 221 items

| Contestant | Mode | Metric (95% interval) | Position consistency | Cost (USD) | Missing answers |
|---|---|---|---|---|---|
| driftbench-reference | pointwise | 73.3 [67.1, 78.7], balanced 69.1 | n/a | 0.7470 | 0 |

New calls 439, new spend 0.7441 USD, replayed 3.
DONE
```

### Trial B: `_captures/jb/testB-v.out`

SHA-256: `ecd878dc8695c29751b6d1e350369667b20fdd545f64ddcb12cac7210b51805b`. Last filesystem write: `2026-10-12T15:46:24.988283+02:00`.

Verbatim complete raw output:

```text
longjudge-verify on haiku: 221 items

| Contestant | Mode | Metric (95% interval) | Position consistency | Cost (USD) | Missing answers |
|---|---|---|---|---|---|
| driftbench-reference3 | pointwise | 74.2 [68.1, 79.5], balanced 68.9 | n/a | 1.4636 | 0 |

New calls 442, new spend 0.7166 USD, replayed 442.
DONE
```

### Trial C: `_captures/jb/testC-longjudge-verify.out`

SHA-256: `8e8e9ee2bac28677c75ff650e4b599f1c6e3412d4d008bbf03fd2ac9da67f854`. Last filesystem write: `2026-10-12T17:36:23.948757+02:00`.

Verbatim complete raw output:

```text
longjudge-verify on haiku: 221 items

| Contestant | Mode | Metric (95% interval) | Position consistency | Cost (USD) | Missing answers |
|---|---|---|---|---|---|
| driftbench-adaptive | pointwise | 73.8 [67.6, 79.1], balanced 68.6 | n/a | 1.4874 | 0 |

New calls 305, new spend 0.1961 USD, replayed 771.
```

## Historical census TEST rows

These seven rows come from `scratchpad/reports/judges-census.md`, section `6. Current table (test split)`, lines 149-155. They are census-derived historical replay results. No predictions or metrics were recomputed in this investigation.

| Contestant | Items | Official score | Cost per 100 USD, as printed | Missing | Source line |
|---|---:|---:|---:|---:|---:|
| driftbench-adaptive | 221 | 73.8 | 0.67 | 0 | 149 |
| driftbench (shipped) | 221 | 72.9 | 0.16 | 0 | 150 |
| DeepEval | 221 | 53.4 | 0.18 | 0 | 151 |
| promptfoo | 221 | 71.0 | 0.18 | 0 | 152 |
| Inspect | 221 | 74.2 | 0.22 | 0 | 153 |
| LangWatch Scenario | 221 | 68.3 | 0.20 | 0 | 154 |
| Langfuse | 221 | 73.3 | 0.18 | 0 | 155 |

The census states that costs count replayed/shared answers per contestant. Summing them can overstate cash spend. The census header says dev-only; the explicit section 6 title and these rows say TEST. This report preserves that source inconsistency and attributes the figures to section 6.

## Earlier all-316 evaluation

The historical command at 12:13:35.027 CEST omits `--split`. The output names 316 items. Its first output contains four complete contestants and two incomplete contestants. Subsequent cap-limited resumptions finish all six, with the final log containing zero missing answers for each.

| Capture | Historical command submission CEST | Last filesystem write CEST | Completion observed |
|---|---|---|---|
| `_captures/jb/haiku-verify.out` | 2026-10-12T12:13:35.027000+02:00 | 2026-10-12T12:56:33.919672+02:00 | Four contestants complete; scenario/langfuse incomplete; EXIT 1 at cap |
| `_captures/jb/haiku-verify2.out` | 2026-10-12T12:57:00.638000+02:00 | 2026-10-12T13:19:44.984389+02:00 | Four complete; scenario 1 missing; langfuse 19 missing; EXIT 1 at cap |
| `_captures/jb/haiku-verify3.out` | 2026-10-12T13:22:56.063000+02:00 | 2026-10-12T13:24:19.843022+02:00 | All six contestants complete, zero missing each |

Verbatim final all-316 output:

```text
longjudge-verify on haiku: 316 items

| Contestant | Mode | Metric (95% interval) | Position consistency | Cost (USD) | Missing answers |
|---|---|---|---|---|---|
| driftbench | pointwise | 69.9 [64.7, 74.7], balanced 66.6 | n/a | 0.5529 | 0 |
| deepeval | pointwise | 50.6 [45.1, 56.1], balanced 44.0 | n/a | 0.6036 | 0 |
| promptfoo | pointwise | 70.9 [65.7, 75.6], balanced 67.2 | n/a | 0.6190 | 0 |
| inspect | pointwise | 73.4 [68.3, 78.0], balanced 68.2 | n/a | 0.7307 | 0 |
| scenario | pointwise | 66.8 [61.4, 71.7], balanced 61.1 | n/a | 0.6618 | 0 |
| langfuse | pointwise | 71.8 [66.6, 76.5], balanced 67.8 | n/a | 0.5928 | 0 |

New calls 19, new spend 0.0403 USD, replayed 1878.
```

These all-316 scores differ from TEST-only scores because the population includes 95 DEV items. They must not be presented as TEST-only metrics.

### Identifier-only population proof

The existing dataset cache predates the initial launch. Its identifier field contains 316 unique ids. Applying the archived split rule yields 95 DEV ids and 221 TEST ids. The sets are disjoint and exhaust all 316 ids. The DEV set exactly matches the existing DEV artifact. No TEST question, response, label, or prediction was read for this check.

```python
test_ids = {id for id in all_ids
    if hashlib.sha256(("split:longjudge-verify:" + id).encode()).digest()[0] >= 77}
assert len(all_ids) == 316
assert len(test_ids) == 221
```

The archived runner retains every item when the split option is absent. Together, the complete all-316 output and this population partition establish exposure of the future TEST items. This remains true even if the TEST designation was first emphasized later.

| Identifier set | Count | SHA-256 of sorted newline-joined ids, no trailing newline |
|---|---:|---|
| all | 316 | `f18e626d63a8c419f7f92e6b465f488dfe13d00c075e8956b95eaab133d7cea2` |
| dev | 95 | `c19a968d699860bc4c678e05b29cf9166df66defc51dbe6be08a2f39361d68ae` |
| test | 221 | `f7bef008c269d20f7d5d5d68f243e39b28a66c667dc5b6c8a4782f744d8fd026` |

Dataset cache SHA-256: `92f7a99e91ee8067d5397042e2104b0e82deaa81fcffcb66a70eac614f7c20af`. Cache mtime: `2026-10-12T11:52:56.798784+02:00`.

## Historical launch commands and clocks

The commands below are copied from historical Bash tool inputs. They were not executed in this investigation. The JSON companion records transcript line numbers, tool ids, record hashes, and full input hashes. A/B/C submissions start a chain that runs JudgeBench before verify. Submission time therefore does not identify the exact verify subprocess start.

### initial-all

Submitted `2026-10-12T10:13:35.027Z` / `2026-10-12T12:13:35.027000+02:00`; transcript line 1639; tool `toolu_01Fpc19YAmUxEKciEn5KMPQF`.

```sh
npx tsx examples/judge-benchmarks/src/run.ts --bench longjudge-verify --model haiku --cap-usd 2.6 --concurrency 8 --out _captures/jb/haiku-verify.json > _captures/jb/haiku-verify.out 2>&1
```

### all-resume-2

Submitted `2026-10-12T10:57:00.638Z` / `2026-10-12T12:57:00.638000+02:00`; transcript line 1757; tool `toolu_01YURCgnW5fdggeeRT3gVVoL`.

```sh
npx tsx examples/judge-benchmarks/src/run.ts --bench longjudge-verify --model haiku --cap-usd 1.0 --concurrency 8 --out _captures/jb/haiku-verify.json > _captures/jb/haiku-verify2.out 2>&1
```

### all-resume-3

Submitted `2026-10-12T11:22:56.063Z` / `2026-10-12T13:22:56.063000+02:00`; transcript line 1783; tool `toolu_01N5fa3iUGqoiKNuXrh3m683`.

```sh
npx tsx examples/judge-benchmarks/src/run.ts --bench longjudge-verify --model haiku --cap-usd 0.1 --concurrency 8 --out _captures/jb/haiku-verify.json > _captures/jb/haiku-verify3.out 2>&1
```

### A

Submitted `2026-10-12T12:28:27.488Z` / `2026-10-12T14:28:27.488000+02:00`; transcript line 1984; tool `toolu_01VGkrYYDyMMANKUozUZNT7U`.

```sh
npx tsx examples/judge-benchmarks/src/run.ts --bench longjudge-verify --model haiku --split test --contestants driftbench-reference --cap-usd 1.1 --concurrency 10 > _captures/jb/testA-v.out 2>&1
```

### B

Submitted `2026-10-12T13:20:39.854Z` / `2026-10-12T15:20:39.854000+02:00`; transcript line 2076; tool `toolu_0163C7gutBMoJx5PSMcz71iJ`.

```sh
npx tsx examples/judge-benchmarks/src/run.ts --bench longjudge-verify --model haiku --split test --contestants driftbench-reference3 --cap-usd 1.0 --concurrency 10 > _captures/jb/testB-v.out 2>&1
```

### C

Submitted `2026-10-12T15:20:22.612Z` / `2026-10-12T17:20:22.612000+02:00`; transcript line 2445; tool `toolu_01XMSxGJsxGKPZFYhYKNvjY4`.

```sh
nohup sh -c "for b in judgebench:1 longjudge-verify:0.8 longjudge-wp:3.5; do n=\${b%%:*}; c=\${b##*:}; npx tsx examples/judge-benchmarks/src/run.ts --bench \$n --split test --contestants driftbench-adaptive --cap-usd \$c --concurrency 4 > $J/testC-\$n.out 2>&1; done; echo DONE > $J/testC.done" > $J/bg-testC.log 2>&1
```

## Clock qualifications

- The ledger header identifies the night of 12 October 2026. Exact UTC transcript timestamps corroborate the date; CEST equals UTC+02:00.
- A/B ledger rows have launch-like times but contain later edited result summaries. Their 14:28 and 15:20 times are not result-completion timestamps.
- C is entered in the ledger at 17:24, while its recorded command submission is 17:20:22.612 CEST. Both values are preserved.
- File mtime means last filesystem write. It does not prove an exact process start or completion time. Historical commands explicitly touch the A/B log files.
- A/B raw output includes a DONE suffix. C contains a completed score table and cost footer; its verify log has no DONE suffix.

## Ledger corroboration

The ledger is live and can receive later appended rows. Hashes identify the observed snapshot and individual selected lines. Historical summary counts can differ from raw output: row 98 says approximately 20 finishing calls, while the final verify log reports 19 new calls. The raw output is used for that count.

Line 1:

```text
# Spend ledger, night of 2026-10-12 (cap 100 USD, stop at 80)
```

Line 81:

```text
| 11:49 | judge-benchmarks cost probe (after: per item, all 6 contestants: JudgeBench 0.0115, MM-Eval 0.0080, wp 0.0191, verify 0.0076 USD): 10 stratified items per benchmark (JudgeBench, MM-Eval, LongJudgeBench wp and verify), 6 contestants, both orders on pairs; job budget 15 USD; includes 1 earlier 0.0001 USD system-prompt probe | haiku | 423 | 0.60 | 0.4658 | +0.4658 (job 0.4658 of 15) |
```

Line 84:

```text
| 12:13 | judge-benchmarks haiku run 2 (after: stopped at its cap; 4 contestants complete, scenario 100 of 316, langfuse none): LongJudgeBench verify_bench_hard, all 316 items, 6 contestants; spend cap flag 2.6 | haiku | 1320 | 2.40 | 2.6088 | +2.6088 (job 3.9281 of 15, run 1 still going) |
```

Line 96:

```text
| 12:57 | judge-benchmarks haiku run 2b (after: stopped at its cap again): verify_bench_hard, the rest of scenario (216) and langfuse (316); spend cap flag 1.0 | haiku | 497 | 0.90 | 1.0317 | +1.0317 (job 9.2725 of 15) |
```

Line 98:

```text
| 13:22 | judge-benchmarks haiku run 1c and 2c (after: verify complete; JudgeBench complete except one pair that fails for every contestant): finish JudgeBench (langfuse 428 calls, retry of failed calls) and verify (20 calls); caps 0.6 and 0.1 | haiku | 434 | 0.45 | 0.4635 | +0.4635 (job 9.7360 of 15) |
```

Line 120:

```text
| 14:28 | judge-benchmarks test run A (after: test JudgeBench 82.5 against promptfoo 83.8; test verify 73.3 against inspect 74.2; not yet on top): the chosen driftbench-reference on the test splits of JudgeBench (229 pairs) and verify (221); caps 1.0 and 1.1 | haiku | 1123 | 1.60 | 1.4673 | +1.4673 |
```

Line 128:

```text
| 15:20 | judge-benchmarks test run B (after: test JudgeBench 85.2, now first, promptfoo 83.8; test verify 74.2, tied with inspect): driftbench-reference3 on the test splits of JudgeBench and verify; caps 1.3 and 1.0 | haiku | 1354 | 1.90 | 1.7443 | +1.7443 |
```

Line 146:

```text
| 17:24 | judge-benchmarks test run C (before): driftbench-adaptive on the test splits of JudgeBench (229), verify (221), wp_bench (173); results read only after the config is frozen on dev; caps 1, 0.8, 3.5 | haiku | ~2500 | 5.30 | pending | |
```

Line 173:

```text
| 20:26 | judges3 phase 1 census: replay only, 0 model calls, rebuilt dev and test decisions from recordings | haiku | 0 | 0 | 0.0000 | +0.0000 |
```

## Source identity

Capture paths resolve relative to the archived judge-benchmarks worktree. Ledger and census paths resolve relative to the lead session directory. Local absolute path prefixes use named placeholders in the public JSON companion. Source hashes, timestamps and relative paths remain unchanged.

| Source | Bytes | SHA-256 |
|---|---:|---|
| `_captures/jb/testA-v.out` | 310 | `5fea79a6b719dc8ca703c2b75d64ed88ac49a311ac52d19b322ca77f45f07309` |
| `_captures/jb/testB-v.out` | 313 | `ecd878dc8695c29751b6d1e350369667b20fdd545f64ddcb12cac7210b51805b` |
| `_captures/jb/testC-longjudge-verify.out` | 306 | `8e8e9ee2bac28677c75ff650e4b599f1c6e3412d4d008bbf03fd2ac9da67f854` |
| `_captures/jb/haiku-verify.out` | 740 | `35020201ff59090f7a162efda63a34a5c9ae9988937287fee1e9c00ad24b8096` |
| `_captures/jb/haiku-verify2.out` | 740 | `b0f8ba2db166dc291e05e5f56d4264ec414ecd94aefd9f50b512f81274537831` |
| `_captures/jb/haiku-verify3.out` | 692 | `aa45ebcb063a14bf608068b1600ff84ed9fa5923207f7f9a53166c21dee1672d` |
| `scratchpad/spend-ledger.md` | 88541 | `aac4caac792827ea2020bef946bf78eb30906fec2a9477460e051c13cf6ca7bd` |
| `scratchpad/reports/judges-census.md` | 17005 | `8d2eb46c9e23f99bcc450a04af6cb940936c9961ef36b4f1348dc6d511cd2b09` |
| `historical subagent transcript: agent-ajudges2-lane-79fa3de2ca4edbbd.jsonl` | 9707357 | `d48bcfd2bb16469bdc6f8a8ded3d50b82427b3d66b358b9780cb1efb2f7a57ff` |
| `examples/judge-benchmarks/src/data.ts` | 11884 | `0ad8c198e952608eb0c3959c6147d98e07253265b72e196d270ddff57ebfdc00` |
| `examples/judge-benchmarks/src/run.ts` | 20327 | `8951a41cfb686132cc41e95fc83478476e353c7158bdaf924ecd262bba26ab48` |
| `results/verify-dev/items.json` | 1192795 | `0b378671ded40adbb968f2d05e6308c7fdd1194fbc4917b65c8882f76e3a4e07` |
| `existing OS cache: driftbench-judge-benchmarks/3b48c632ac204173` | 3891573 | `92f7a99e91ee8067d5397042e2104b0e82deaa81fcffcb66a70eac614f7c20af` |

## Limits and wording for tonight

- The search establishes positive exposure. It does not establish an exhaustive global history or the absence of earlier evaluations.
- A ledger sample at 11:49 predates the all-316 launch. Its sample ids were not inspected; 12:13 is not claimed as the earliest possible TEST exposure.
- Historical source hashes are current observed snapshots. A filename or mtime alone does not establish an immutable historical source-code version.
- No model call, new TEST prediction, TEST-item correctness review, or audited TEST calculation occurred in this investigation.

Suggested disclosure:

> The selected configuration is frozen before tonight's confirmation run on the existing 221-item TEST partition. Baseline and candidate judges previously evaluated this partition on 12 October 2026. Tonight's result is confirmation on a reused test split; it is not a first evaluation on an untouched holdout.

## Observed reproduction checks

The report companion parses as JSON. All three raw TEST score/cost rows match their captured tables. Capture hashes remain unchanged. Their complete outputs appear verbatim above. All capture references are relative paths. The census supplies seven separately attributed rows.

The identifier-only check reproduces the 316/95/221 population partition and matches the existing DEV id set. Direct reads of the archived split function and runner filter corroborate the rule. No scoring harness or model was run. These checks pass at 2026-10-13T00:39:17.816684+00:00.
