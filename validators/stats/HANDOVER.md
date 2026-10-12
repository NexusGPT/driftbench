# Handover: validator stats

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate stats --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 1 |
| 2 | 1 |
| 3 | 1 |
| 4 | 1 |
| 5 | 1 |
| 6 | 1 |
| 7 | 1 |
| 8 | 1 |
| 9 | 1 |
| 10 | 1 |
| 11 | 1 |
| 12 | 1 |
| 13 | 1 |
| 14 | 1 |
| 15 | 1 |
| 16 | 1 |
| 17 | 1 |
| 18 | 1 |
| 19 | 1 |
| 20 | 1 |
| hidden | 1 |
<!-- level-table:end -->

The stats validator is ladder version 2 (docs/validators.md section 12): a bank of 1201 items in seven levels, each with threshold 1. A level passes on a seed only when every one of its items passes. The bank score is the share of items that pass on every seed; `validators/stats/bank-scores.jsonl` holds one row per iteration, iteration 0 first. Journal row 1 is iteration 0 (the schema starts at 1); rows 2 to 11 are the ten pilot iterations.

After the pilot (branch `exec/stats-pilot`, statistics fixes in `packages/stats`): 466 of 1201 items pass on every seed, score 0.388; iteration 0 was 422 (0.351). Level 1 on every seed: the `degenerate` level still fails first.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The floor there belongs to ladder version 1 (levels 1 and 2 of the old two-level ladder). Version 2 starts at the level its pilot reached; the maintainer sets it (section 12.5).

## Open items

The first failing level is `degenerate` on every seed. After the pilot its failing items are, in bank order: `cusum` was fixed last; next come `betaQuantile(NaN, 2, 3)` (returns 2.8e-17, must be NaN), `designEffect(Infinity, 0.1)`, `mde` with an infinite n or repeats, `repeatsForFloor` with an infinite variance or blocks, `neymanAllocation` with an infinite size, `krippendorffAlpha` and `cohenKappa` with an unknown level or weights, the domain items of `normalCdf`, `chiSquareSf`, `logGamma`, `incompleteBeta`, and the exact all-equal answers of `mean`, `sampleVariance`, `bootstrapCI` and `varianceComponents`. Run the ladder for the live list: each item names the call, what came back, what was expected and the file.

## Hypotheses tried

The ten pilot iterations (journal rows 2 to 11), one function each, every one confirmed by its items turning green:
1. `pageHinkley` (drift.ts): no input check. Fixed 6 items.
2. `mean` (basics.ts): non-finite values summed. Fixed 9 items, among them `sampleVariance` and `cusum` items that call `mean`.
3. `quantile` (basics.ts): non-finite values and a NaN level. Fixed 4.
4. `quantileSorted` (basics.ts): non-finite and unsorted input. Fixed 10, among them `unreliability` and `bootstrapCI`, which call it.
5. `wilcoxonSignedRank` (paired.ts). Fixed 3.
6. `ksTest` (drift.ts): a NaN looped forever. Fixed 4.
7. `wilson` (intervals.ts): z unchecked. Fixed 2.
8. `effectiveSampleSize` (intervals.ts). Fixed 2.
9. `hillNumber` (coverage.ts): q unchecked. Fixed 1.
10. `cusum` options (drift.ts). Fixed 3.
Rejected: none. A shared finiteness helper would fix more items per iteration; the pilot fixed one function per iteration, as an executor reading the first failing item does.

## Next actions

1. Run `pnpm driftbench validate stats --seed 1` and read the items of the first failing level (`degenerate`). Pick one function (one source file) and fix its items only; write the test in `packages/stats/test/degenerate.test.ts` first and see it red.
2. Run `pnpm -s vitest run packages/stats`, then score the bank: `pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden --record <next iteration number>`.
3. Build the journal row (the metrics are the per-level pass shares from the score row) and append it with `pnpm driftbench validate stats --journal row.json`, then rewrite this file.

## Pitfalls

* Never edit the bank: `packages/validators/src/ladders/stats/**` and `packages/validators/fixtures/stats/**`. An item you think is wrong goes to the maintainer with the oracle's answer and a counter-example (section 12.3).
* The degenerate-input contract has three rules. Rule 1: a statistical procedure throws a RangeError on input it cannot answer for (no data, NaN, an infinite value, a count or probability out of range, mismatched lengths, an unknown option). Rule 2: a function in `special.ts` given NaN returns NaN or throws a RangeError; at the edge of its domain it returns the scipy limit. Rule 3: on one value or all-equal values a function returns the defined answer exactly, never NaN.
* `ksTest` with a NaN never ends: the item is stopped after 20 seconds. Each seed's bank runs in up to four child processes, so one endless loop fails one item and the run goes on.
* A roadmap item that says "packages/stats does not export X" gives the signature, the definition and the source. Add the function to the file named, export it from `packages/stats/src/index.ts`, and the item's cases (in `packages/validators/fixtures/stats/roadmap.json`) tell you the expected values. The same method then has degenerate, purity, scale and, for rate intervals, exact-coverage items.
* Fixing a shared helper (for example a finiteness check in `basics.ts`) can change many functions at once. That is allowed, but say so in the journal row: it is one cause.
* Simulation items count over draws. The bars leave room for a correct estimator on every seed (measured on 21 seeds); a failure on one seed alone is still a failure.
* One seed's bank takes about 10 to 60 seconds of wall time with four child processes, depending on the load of the machine; 21 seeds 4 to 25 minutes.
* Timing: the one-million-row items count processor time (5 s budget), and an item is stopped after 120 s of wall time (300 s for simulation and scale items) only to catch an endless loop.
* Several items draw their case from the seed (for example `analytic.allocation.neyman-optimal.*`): the hidden seed changes with every commit, so such an item can pass on one commit's hidden seed and fail on the next. That is a real defect on some inputs, not noise.

## How to run

```
pnpm driftbench validate stats --seed 1
pnpm driftbench validate stats --seeds 1..20 --hidden
pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden
pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden --record <iteration> --note "<one line>"
```

The score command prints the bank size, the items passing on every seed, the score, the level per seed and the split by family and tier; with `--record` it appends the row to `validators/stats/bank-scores.jsonl` and prints the forecast of section 12.4.

## Fixtures

* `packages/stats/test/reference/fixtures.json`: the scipy and numpy reference values of level `reference` (version 1's level 1), written by `make_fixtures.py` next to it.
* `packages/validators/fixtures/stats/designs.json`: the planted designs of level `simulation` (version 1's levels 2 to 6): clustered designs, the pilot design, the populations, the planned campaigns.
* `packages/validators/fixtures/stats/roadmap.json`: the roadmap methods (signature, definition, source, cases with scipy values), written by `make_roadmap.py` next to it (`python3 packages/validators/fixtures/stats/make_roadmap.py` from the repository root, scipy 1.18 and numpy 2.5).
* The bank: `packages/validators/src/ladders/stats/bank/`: `reference.ts`, `degenerate.ts`, `reproducibility.ts`, `analytic.ts`, `simulation.ts`, `scale.ts`, `roadmap.ts`; `isolate.ts` and `child.ts` run it; `hardness.ts` and `score-cli.ts` score it.
