# Handover: validator system

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate system --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |
| 5 | 0 |
| 6 | 0 |
| 7 | 0 |
| 8 | 0 |
| 9 | 0 |
| 10 | 0 |
| 11 | 0 |
| 12 | 0 |
| 13 | 0 |
| 14 | 0 |
| 15 | 0 |
| 16 | 0 |
| 17 | 0 |
| 18 | 0 |
| 19 | 0 |
| 20 | 0 |
| hidden | 0 |
<!-- level-table:end -->

The level per seed is 7 of 11 after pilot iteration 10, on branch exec/system-pilot. On lane/v-system, which does not carry the pilot fixes, the level is 0: store/units-latest and store/bundle-tampered still fail there.

## Floor

None yet for system; `pnpm driftbench validate floors` prints the floors. The ladder is version 2 (the item bank). A first floor of 7 would hold on exec/system-pilot.

## Open items

93 items fail after the pilot (iteration 10, 572 of 665 pass on every seed). Each failing item prints "asks: <capability>. found: <what came back>" and names its component; act on that line, the validator's code is not needed. By cause:

1. The report package (packages/report/src): 82 items. The contract is the comment at the top of packages/validators/src/ladders/system/bank/report.ts. Built so far, on exec/system-pilot: report.diff, and report.scorecard with runs, passing, passRate, interval, drift, cost.usd and recovery.measured and recovery.labels per group. Missing, one field per iteration: clustered, designEffect, firstDriftBlock, driftRate, longestClean, recovery.safeActionRate, recovery.clarificationGain, recovery.turnsToRecover, cost.perBlock, latency.p50, latency.p90, latency.max, cells (passRate, passAtK, passHatK, unreliability), report.junit, report.compare.
2. driftbench ci (packages/cli/src/commands/ci.ts is a stub): 5 items (cli/ci/*). The ci lane's command (branch lane/ci) is what they test.
3. Planned commands: cli/report/scorecard-command, cli/compare/command, cli/plan/mde-rho (a --rho option on campaign plan).
4. Scale: scale/flow-blocks/growth, scale/flow-blocks-teacher-forced/growth, scale/flow-blocks-replayed/growth. A run of 400 blocks costs about a hundred times one of 40: the cache key and the Given hash cover the whole history on every block, and the function adapter clones the whole history on every send. Fix the per-block cost so it does not grow with the run.

## Hypotheses tried

The pilot (iterations 1 to 10, journal rows 1 to 10, branch exec/system-pilot) fixed one cause each and every one held: cost units kept by date (store), record hashes in bundles (store), plan refuses a target with no adapter (cli), the cache key without the version label (runner), report.diff, then report.scorecard fields. No hypothesis was rejected.

## Next actions

1. Implement the next scorecard field in packages/report/src/scorecard.ts, starting with `clustered` and `designEffect` (items scorecard/*/clustered-interval and scorecard/*/design-effect), one field per iteration.
2. Implement report.junit (items scorecard/junit/*) and then report.compare (items compare/*) in packages/report/src.
3. Make the per-block cost of a run independent of the run's length (items scale/flow-blocks*/growth).

## Pitfalls

* Run the measurement alone: `--items` runs every level on 21 seeds, about 4 minutes on an idle machine and up to 25 minutes at a load of 150. Parallel jobs slow it, they do not speed it.
* Use files of your own, never /tmp/<common name>: another lane overwrote a shared /tmp file during the pilot.
* The scale items time CPU, not wall time, so a busy machine does not fail them; the growth bound is 25 from ten to a hundred times the size.
* The variance family holds three Monte Carlo items (variance/wilson-calibration, variance/design-effect-calibration, variance/parity-power); each can fail a correct chain on about 2 seeds in 1000 (packages/validators/fixtures/system/design.json).
* An item that is wrong is the maintainer's to fix, in a commit of its own on a non-executor branch: two were fixed this way in the pilot (stageObserved now follows docs/concepts/drift.md; scale timing).
* docs/running.md lags the run-modes work in places (the drift table, stageObserved, mode T on the command line); docs/concepts/*.md is the contract the bank follows.

## How to run

```
pnpm driftbench validate system --seeds 1..20 --hidden --items --json > after.json
pnpm -s exec tsx packages/validators/src/ladders/system/journal-row.ts --before before.json --after after.json --iteration <n> --hypothesis "<one sentence>" --files a,b --commit <sha> --model sonnet > row.json
pnpm driftbench validate system --journal row.json
pnpm driftbench validate system --hardness
```

The ladder is registered in packages/validators/src/ladders/index.ts (a root file).

## Fixtures

* packages/validators/fixtures/system/bank-manifest.json: every item (id, family, tier, level, source, component); a test compares it with the bank.
* packages/validators/fixtures/system/design.json: the design point of the Monte Carlo items.
* The fault family: examples/acme/faults, read through the gate's importFaultSet; the operator per class is OPERATORS in packages/validators/src/ladders/system/family.ts.
* Everything else is generated from the seed under packages/validators/src/ladders/system/bank/.
