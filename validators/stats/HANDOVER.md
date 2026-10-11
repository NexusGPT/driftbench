# Handover: validator stats

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate stats --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

The stats validator is ladder version 2 (docs/validators.md section 12): a bank of items in seven levels, each with threshold 1. A level passes on a seed only when every one of its items passes. The bank score is the share of items that pass on every seed; `validators/stats/bank-scores.jsonl` holds one row per iteration, iteration 0 first.

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The floor there belongs to ladder version 1 (levels 1 and 2 of the old two-level ladder). Version 2 starts at the level its pilot reached; the maintainer sets it (section 12.5).

## Open items

The first failing level is `degenerate` on every seed. Its items are the open items. Each one names the call, what came back, what was expected, and the file to change. The levels after it are mostly roadmap work: methods the package does not have yet.

## Hypotheses tried

None yet besides the pilot rows of the journal. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Run `pnpm driftbench validate stats --seed 1` and read the items of the first failing level. Pick one function (one source file) and fix its items only.
2. Run the statistics package tests (`pnpm -s vitest run packages/stats`) and the item again, then score the bank: `pnpm exec tsx packages/validators/src/ladders/stats/bank/score-cli.ts --seeds 1..20 --hidden --record <iteration>`.
3. Append the journal row with `pnpm driftbench validate stats --journal row.json`, then rewrite this file.

## Pitfalls

* Never edit the bank: `packages/validators/src/ladders/stats/**` and `packages/validators/fixtures/stats/**`. An item you think is wrong goes to the maintainer with the oracle's answer and a counter-example (section 12.3).
* The degenerate-input contract has three rules. Rule 1: a statistical procedure throws a RangeError on input it cannot answer for (no data, NaN, an infinite value, a count or probability out of range, mismatched lengths, an unknown option). Rule 2: a function in `special.ts` given NaN returns NaN or throws a RangeError; at the edge of its domain it returns the scipy limit. Rule 3: on one value or all-equal values a function returns the defined answer exactly, never NaN.
* `ksTest` with a NaN never ends: the item is stopped after 20 seconds. Each seed's bank runs in up to four child processes, so one endless loop fails one item and the run goes on.
* A roadmap item that says "packages/stats does not export X" gives the signature, the definition and the source. Add the function to the file named, export it from `packages/stats/src/index.ts`, and the item's cases (in `packages/validators/fixtures/stats/roadmap.json`) tell you the expected values. The same method then has degenerate, purity, scale and, for rate intervals, exact-coverage items.
* Fixing a shared helper (for example a finiteness check in `basics.ts`) can change many functions at once. That is allowed, but say so in the journal row: it is one cause.
* Simulation items count over draws. The bars leave room for a correct estimator on every seed (measured on 21 seeds); a failure on one seed alone is still a failure.
* One seed's bank takes about 30 seconds of wall time with four child processes; 21 seeds about 10 minutes.

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
