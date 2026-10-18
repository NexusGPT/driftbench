# Budget selection on Acme

This comparison runs the approved Acme map at budgets 20, 50, 100 and 200, with seed 1. It compares `--t 2 --max N` with `--t 2 --budget N`. The reference agents and planted faults are scripted. No model is called.

## Full paired grid and numeric ablation

[full-study.md](full-study.md) reports hybrid, pure pairwise and random at budgets 20, 50, 100 and 200 over seeds 1 through 30. It includes sample deviations, ranges, confidence intervals, exact paired tests, complete/incomplete counts, wall time, the four task-fault reachability diagnoses and a numeric sliced-LHS/uniform comparison. Its raw records pin their measurement source and map hashes separately. The earlier measurements below are retained.

## Results

Measurements use the numeric implementation in `4bb18278097cff49f8d5d8c38c0a9a6f62107115`, via the offline scripts below. The map hash is `b583de68c530`. Every budget run uses seed 1. Every complete spec passes its reference blocks.

| N | Mode | Whole specs: complete / incomplete | Whole faults / 13 | Whole pairs | Selected rows: complete / incomplete / total | Selected faults / 13 | Selected pairs | Maximum value gap |
|---|---|---|---|---|---|---|---|---|
| 20 | pairwise | 114 / 22 | 13/13 | 379/637 | 20 / 0 / 20 | 8/13 | 73/314 | 16.00 |
| 20 | budget | 251 / 69 | 13/13 | 637/637 | 20 / 0 / 20 | 9/13 | 154/314 | 2.00 |
| 50 | pairwise | 194 / 52 | 13/13 | 549/637 | 50 / 0 / 50 | 9/13 | 174/314 | 12.00 |
| 50 | budget | 248 / 70 | 13/13 | 637/637 | 49 / 1 / 50 | 9/13 | 232/314 | 5.00 |
| 100 | pairwise | 254 / 70 | 13/13 | 637/637 | 99 / 1 / 100 | 9/13 | 264/314 | 27.00 |
| 100 | budget | 251 / 70 | 13/13 | 637/637 | 99 / 1 / 100 | 9/13 | 282/314 | 9.00 |
| 200 | pairwise | 251 / 70 | 13/13 | 637/637 | 131 / 1 / 132 | 9/13 | 314/314 | 31.60 |
| 200 | budget | 320 / 70 | 13/13 | 637/637 | 199 / 1 / 200 | 9/13 | 314/314 | 17.00 |

Whole pairs use all seven map axes. Selected pairs use the five conversation-selection dimensions. Their denominators differ.

The Acme budget-20 command exits 1 because it writes 69 incomplete specs, not because the budget leaves pairs uncovered. Other runs show their own incomplete counts above.

### Per-value balance

The entries below are the largest count gaps in each dimension. [balance.csv](balance.csv) lists every allowed value, including zero counts, its fair share and its signed gap. [results.json](results.json) also holds every count and the fault witnesses.

| N | Mode | Behaviour | Deviation | Channel | User type | Coverage result |
|---|---|---|---|---|---|---|
| 20 | pairwise | 9.33 | 0.82 | 2.00 | 10.00 | 16.00 |
| 20 | budget | 1.33 | 0.82 | 0.00 | 2.00 | 2.00 |
| 50 | pairwise | 6.83 | 0.55 | 0.00 | 3.00 | 12.00 |
| 50 | budget | 2.17 | 1.55 | 0.00 | 5.00 | 3.00 |
| 100 | pairwise | 8.33 | 0.91 | 0.00 | 16.00 | 27.00 |
| 100 | budget | 4.33 | 1.09 | 0.00 | 2.00 | 9.00 |
| 200 | pairwise | 0.00 | 0.00 | 0.00 | 18.00 | 31.60 |
| 200 | budget | 5.67 | 3.18 | 0.00 | 5.00 | 17.00 |

### Paired controls at 20 rows

Hybrid and random selection use the same 747-cell pool over seeds 1 through 30. Random draws 20 distinct allowed cells uniformly without replacement. Hybrid selects 20 cells by new pairs, value balance and seeded tie-breaks. Both use the same scenario renderer, references and fault checks. The selector seed affects its tie-breaks; the renderer also uses that seed in both methods. No other seeders contribute to these selected-row controls.

| Metric | Hybrid mean | Hybrid sample SD | Hybrid range | Random mean | Random sample SD | Random range | Mean paired difference | Exact two-sided p |
|---|---|---|---|---|---|---|---|---|
| Faults caught | 9.00/13 | 0.00 | 9 to 9 | 8.37/13 | 0.76 | 7 to 9 | 0.63 | 0.0001220703125 |
| Pairs covered | 153.60/314 | 0.62 | 152 to 154 | 119.30/314 | 4.78 | 110 to 130 | 34.30 | 1.862645149e-09 |

Hybrid seed 1 catches 9/13 faults and covers 154/314 pairs. Both fault distributions use the fixed denominator of 13; only nine sales faults apply to selected conversations.

The exact paired test swaps method labels independently within each seed, using the absolute mean difference as its two-sided statistic. Integer-sum dynamic programming counts all 2^30 assignments exactly, including ties and equal-extreme tails; no Monte Carlo approximation or added-one correction is used. The null assumes exchangeable method labels within each seed pair and independent swaps across pairs. The p-values are unadjusted for the two metrics and are conditional on this null, this map and these scripted faults. They do not establish a general or causal advantage.

| Metric | Hybrid wins / ties / losses | Extreme assignments / all assignments |
|---|---|---|
| Faults | 14 / 16 / 0 | 131072 / 1073741824 |
| Pairs | 30 / 0 / 0 | 2 / 1073741824 |

The per-run counts use the same rule: incomplete rows are excluded from fault scoring and kept in selected pair counts. These pair counts describe drawn categorical cells, including incomplete proposals, rather than runnable coverage.

| Seed | Hybrid complete / incomplete | Hybrid faults / 13 | Hybrid pairs / 314 | Random complete / incomplete | Random faults / 13 | Random pairs / 314 |
|---|---|---|---|---|---|---|
| 1 | 20 / 0 | 9 | 154 | 20 / 0 | 9 | 123 |
| 2 | 20 / 0 | 9 | 154 | 20 / 0 | 8 | 111 |
| 3 | 20 / 0 | 9 | 153 | 20 / 0 | 9 | 122 |
| 4 | 20 / 0 | 9 | 154 | 19 / 1 | 7 | 122 |
| 5 | 20 / 0 | 9 | 152 | 20 / 0 | 7 | 121 |
| 6 | 20 / 0 | 9 | 153 | 20 / 0 | 8 | 116 |
| 7 | 20 / 0 | 9 | 154 | 20 / 0 | 8 | 110 |
| 8 | 20 / 0 | 9 | 154 | 20 / 0 | 9 | 113 |
| 9 | 20 / 0 | 9 | 154 | 19 / 1 | 8 | 119 |
| 10 | 20 / 0 | 9 | 153 | 20 / 0 | 9 | 126 |
| 11 | 20 / 0 | 9 | 154 | 19 / 1 | 9 | 116 |
| 12 | 20 / 0 | 9 | 154 | 18 / 2 | 9 | 124 |
| 13 | 20 / 0 | 9 | 153 | 20 / 0 | 8 | 123 |
| 14 | 20 / 0 | 9 | 154 | 20 / 0 | 7 | 119 |
| 15 | 19 / 1 | 9 | 154 | 20 / 0 | 9 | 117 |
| 16 | 20 / 0 | 9 | 154 | 20 / 0 | 8 | 116 |
| 17 | 20 / 0 | 9 | 153 | 19 / 1 | 8 | 123 |
| 18 | 20 / 0 | 9 | 154 | 19 / 1 | 9 | 119 |
| 19 | 20 / 0 | 9 | 154 | 19 / 1 | 9 | 118 |
| 20 | 20 / 0 | 9 | 153 | 20 / 0 | 9 | 120 |
| 21 | 20 / 0 | 9 | 153 | 20 / 0 | 8 | 113 |
| 22 | 20 / 0 | 9 | 154 | 20 / 0 | 9 | 122 |
| 23 | 20 / 0 | 9 | 154 | 19 / 1 | 9 | 114 |
| 24 | 20 / 0 | 9 | 154 | 18 / 2 | 7 | 123 |
| 25 | 20 / 0 | 9 | 154 | 20 / 0 | 9 | 114 |
| 26 | 19 / 1 | 9 | 153 | 20 / 0 | 9 | 124 |
| 27 | 20 / 0 | 9 | 154 | 19 / 1 | 9 | 122 |
| 28 | 20 / 0 | 9 | 154 | 20 / 0 | 8 | 115 |
| 29 | 20 / 0 | 9 | 154 | 20 / 0 | 9 | 124 |
| 30 | 20 / 0 | 9 | 152 | 19 / 1 | 7 | 130 |

Each method selects 600 rows. Hybrid has 2 incomplete rows and random has 13. Every complete row passes its reference blocks and the equivalence check for the excluded first-email fault.

[random-results.json](random-results.json) and [hybrid-results.json](hybrid-results.json) contain every seed, selected pool index, incomplete cell, witness and reference check. [paired.ts](paired.ts) implements the exact test; its tests compare against independent exhaustive enumeration on small cases and a closed-form all-wins case. Run both controls after the budget comparison:

```bash
pnpm exec tsx comparisons/budget/random-control.ts
pnpm exec tsx comparisons/budget/hybrid-control.ts
```

## What the numbers count

- Selected rows are the t-wise rows or their budget replacements. Their pair counts include every selected categorical cell, including incomplete rows, over the same five dimensions and constrained pool. These counts describe the selection design, not runnable coverage.
- Whole-suite counts use every complete spec under `specs/`, including the other seeders and coverage completion. Incomplete specs are counted separately and are not run.
- For every method, incomplete rows are excluded from fault scoring and kept in selected pair counts. A fault is caught when a complete block passes its machine checks on the reference agent and fails those checks on the faulty agent. Runs use free-running mode, one repeat and the scripted user driver. This is a fault-detection comparison before the validity gate.
- The fixed denominator is 13: the two identity controls are excluded, and `x2-keeps-first-email` is equivalent on the generated suite. The measurement checks that equivalence on each measured sales conversation. Selected rows have no ops tasks, so four of the 13 faults can only be caught by the rest of the suite.
- Balance is measured per allowed value, including values selected zero times. Its fair share is the selected row count divided by the number of allowed values in that dimension. Maximum deviation is the largest absolute difference from that share.

Pairwise mode uses the generator's `--max N` limit. Budget mode replaces only the t-wise selections and leaves the other seeders at their defaults. Task families keep their own `--tasks` count in both modes. Coverage completion can add tests for pairs the selected rows miss. These commands therefore compare the existing CLI modes, not two suites with equal total run costs.

## Reproduce

Run from the repository root with Node and pnpm installed:

```bash
pnpm install --frozen-lockfile
pnpm exec tsx comparisons/budget/measure.ts
```

The script saves its measured records in `comparisons/budget/results.json`. It writes suites, reports and captured command output under `_captures/budget/`. It routes conversations to `function:acme-sales` and tasks to `process:acme-ops`, using `examples/acme/faults` for the planted faults. It checks selected cells against the reported pair coverage and budget counts before scoring.

These are the generation commands the script runs for every budget:

```bash
for N in 20 50 100 200; do
  pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out _captures/budget/pairwise-$N --t 2 --seed 1 --max $N --force
  pnpm -s driftbench generate --map examples/acme/map/approved.yaml --out _captures/budget/budget-$N --t 2 --seed 1 --budget $N --force
done
```

Generation can exit 1 after writing a suite with incomplete specs or a seeder cut. The measurement treats exit 2 as an input error and stops. Partial budget coverage itself does not cause exit 1.

## Verification

The selector tests compare each greedy pick with every available candidate, including picks after full coverage. They also check constraints, repeatability, the pool cap, absent values and numeric bands. A temporary mutation that picked the first shuffled candidate caused coverage-order and balance tests to fail; the selector was restored. A CLI test on a complete map exits 0 with only 3 of 8 pairs covered.

```bash
pnpm exec vitest run packages/generate/test/seed/budget.test.ts packages/generate/test/enumerate/budget.test.ts packages/generate/test/extract/numeric.test.ts packages/cli/test/generate.test.ts tools/analysis/paired-control.test.ts --maxWorkers=2
pnpm typecheck
pnpm lint
```

Approved `numeric_settings` ranges are sampled by the budget generator into `given.vars`. Their quantiles are Latin across the budget and within every selected categorical slice, including unequal slice sizes. A red-first test fails on the earlier ordinary LHS because one slice repeats band 1 and misses band 4. The production CLI test checks both strata and adapter delivery. Integer variables map quantiles to integer levels, so their values may repeat. See [the numeric schema and sampling rules](../../docs/generating.md#numeric-runtime-settings).

Acme has no numeric settings. Golden hashes for its pairwise output and all four budgets prove every generated file is byte-identical to the pre-numeric code. The measurements above are rerun after the numeric wiring. Automatic range extraction remains pending; variable-to-option mapping belongs to each adapter.
