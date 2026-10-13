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
The stats validator is ladder version 2: 651 items in seven levels, each with threshold 1. The bank score is the share of items passing on every seed (seeds 1 to 20 and the hidden seed).

## State (executor exec/stats-v2, branch of lane/v-stats)

This branch does not hold the statistics fixes of the old pilot branch (exec/stats-pilot), so its starting point is iteration 0: 418 of 651 items (0.6421). After journal iterations 11 to 15 (one cause each, commits 661bc502, a3c406d1, da3879de, bdae2638, 100f64c5) the full sweep at 100f64c5 shows 435 of 651 (0.6682), 57 failing causes, level 1 on every seed. Journal rows 11 to 14 were measured on seed 1 only (one sweep at a time under load): their passing counts are not comparable to row 15.

Fixed so far: mde at a baseline of 0 or 1; designEffect below its bound; zeroFailureBound at a tiny p; campaign plan uses stats.mde (new `--rho`); the report run pass interval (Wilson on effective runs, t quantile; coverage 0.97 and 0.95 on the two planted designs).

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. Ladder version 2 has no floor yet; the maintainer sets it.

## Open items

1. The missing methods (55 items, 7 causes): `clusteredMeanInterval`, `designEffectFromData`, `iccOneWay`, `kishEffectiveSize`, `oneWayAnova`, `stratifiedMean`, `weightedMean`. Each item names its signature, definition and source; the cases are in `packages/validators/fixtures/stats/roadmap.json`.
2. Degenerate inputs (about 130 items): per function, a RangeError that names the argument, the scipy limit at the edge of the special functions, exact answers on one or all-equal values. A shared finiteness helper fixes many at once (say so in the journal).
3. Product: `sessionRate` in @agent-nexus/driftbench-estate (4 items), the early stop (1 item), chaoCoverage just above the class count, neymanAllocation rounding (11 items).
4. `simulation.newcombe.n30` fails on one seed of 21 (pairedRateDifference coverage); not touched yet.

## Hypotheses tried

* A scaled percentile bootstrap (interval widened by t / z): coverage 0.898 at 6 x 5, short of 0.95. Rejected.
* Student t interval on the spec rates: 0.889. Rejected.
* Wilson on the effective runs with the t quantile: 0.972 and 0.950. Kept.

## Next actions

1. Add the missing methods one per iteration, test first (`packages/stats/test/`), export from `packages/stats/src/index.ts`.
2. Run the sweep one at a time: `pnpm -s driftbench validate stats --seeds 1..20 --hidden --items --json > out.json` from a copy of the tree (a sweep takes 30 to 50 minutes at a load of 140).
3. Build the journal row from the json (`bank` block) and append it with `pnpm -s driftbench validate stats --journal row.json`.

## Pitfalls

* Never edit the bank: `packages/validators/src/ladders/stats/**` and `packages/validators/fixtures/stats/**`.
* Memory is tight: vitest with `--maxWorkers=2`, only on the packages you touch; one sweep at a time.
* The degenerate contract: Rule 1, a procedure throws a RangeError naming the argument for input it cannot answer; Rule 2, `special.ts` returns NaN or throws, and returns the scipy limit at the domain edge; Rule 3, one value or all-equal values return the defined answer, never NaN.
* The report snapshot `packages/report/test/__snapshots__/acme-x3-scorecard.html` moved with the new interval; update it with `vitest -u` only for an interval change.
* github.com may be unreachable; retry the push every 60 s.

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
