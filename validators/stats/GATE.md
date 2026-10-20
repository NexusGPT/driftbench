# Stats validator: where the gate stands

## Ladder version 4: the weights family

Version 4 adds the 181 items of the weights family to the bank of version 3 (1085 items). The recorded bar below stays the one of version 3 until the version 4 pilot is measured: the independent blind pilot reads the failing list of the whole bank, and `driftbench validate stats --hardness` prints the score, the forecast and the distinct causes it measured. The audit of the family (four checks, round 2) is pending in [audit-weights/audit.md](audit-weights/audit.md), so the gate is not met. No floor is set for version 4 yet: it is set at the level the pilot reaches, with that evidence.

## Ladder version 3: the recorded bar

Max score after the pilot: 0.85
Min forecast: 9
Min distinct failing causes: 80

The owner's fallback, verbatim: "If you cannot do it, lower the bar per validator". The lead recorded this bar for ladder version 3 after the blind pilot below, with the reason below.

### The measurement

The pilot is blind: a fresh executor, given only the stripped failing-item list, repaired the iteration-0 copy of `packages/stats` (commit `141a67d8`) for ten iterations. The starting package is that copy, loaded through `DRIFTBENCH_STATS_IMPL`, because `main` already holds the fixes of the earlier iterations and an executor on `main` has no failing items to read; the CLI and the other packages were at `main`. The bank is the 904 items of this branch. The rows are the `executor: blind` rows of `journal.jsonl`; the commits are on `pilot/stats-v3-blind`.

| Measure | Value | Section 12.4 | Recorded bar |
|---|---|---|---|
| Bank | 904 items, 22 families, tiers 1 to 5 | 300 items: holds | |
| Score at iteration 0 | 0.6504 (588 of 904) | | |
| Score after the pilot | 0.8263 (747 of 904) | at most 0.4: not met | at most 0.85: met |
| Items fixed per iteration | 15.9 (mean over ten iterations) | | |
| Forecast | 9.87 iterations (157 failing / 15.9) | at least 100: not met | at least 9: met |
| Distinct failing causes | 85 | at least 100: not met | at least 80: met |
| Audit | `audit.md` pending for this bank | required | required |

### Why the bar is out of reach, in numbers

* A forecast of 100 at 15.9 items per iteration needs about 1590 failing items after the pilot. The whole bank is 904 items.
* A score of 0.4 after the pilot needs about 540 failing items after ten iterations; the pilot cleared 159 of 316 in ten iterations. Three iterations (the empty-input messages, the guard messages, the non-finite data) cleared 95 items, because one shared helper in an executor's hand turns many items green.
* The package is small: the differential sweep covered its 57 exports. Real causes are bounded by what the package computes. The bank holds 85 distinct causes after the pilot; 11 of them are the sweep defects and the four statistics the docs define and the package lacks (batches 10 and 11 of [NEEDS.md](NEEDS.md)). The other 74 are guards, edge limits, coverage designs and missing methods. Items beyond that would be methods no page asks for: the 155 quarantined methods, which section 12.1 rules out as padding.
* The blind pilot found one validator defect on the way (an English-word argument had to be quoted but the hint did not say so); it is fixed in its own pull request, and the pilot rows are the measurement before that fix.

The terms below are met by the pilot as measured. They are not a promise that a harder bank cannot be written: a new capability with a page that needs it adds causes, and the bar is read again then.

## Ladder version 2 (history)

Status, 2026-10-12: the owner closed the validator design ("we've done enough work on validator honestly, let's just start building and iterating"). The stats validator merges with the lowered bar below, set to what its honest bank meets. It does not meet the section 12 contract (forecast 100, score after the pilot 0.4, 100 distinct causes), and no item was added to reach it. Every item names its need in [NEEDS.md](NEEDS.md).

## The recorded bar

Version 2 bar (history): score after the pilot at most 0.7, forecast at least 70, at least 60 distinct failing causes.

The owner's fallback, verbatim: "If you cannot do it, lower the bar per validator". The stats bar is what this honest bank meets: a forecast of at least 70 iterations (measured 73.21), a score after the pilot of at most 0.7 (measured 0.6851) and at least 60 distinct failing causes (measured 62). `driftbench validate stats --hardness` reads the three lines above (`parseGate` in `packages/validators/src/hardness.ts`, which takes a value only when it lowers the section 12.4 term). The audit (12.7) still applies: the stats-v2 audit judged the old bank, and this bank has no `audit.md` yet.

## The numbers

From `driftbench validate stats --hardness`, after the stats-v2 audit findings (batch 6, see [NEEDS.md](NEEDS.md)):

| Measure | Value | Gate (docs/validators.md section 12) |
|---|---|---|
| Bank | 651 items, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |
| Score at iteration 0 | 0.6421 (418 of 651) | |
| Score after the pilot | 0.6851 (446 of 651) | at most 0.4: not met |
| Items fixed per iteration | 2.8 | |
| Forecast | 73.21 iterations (205 failing / 2.8) | at least 100: not met |
| Distinct failing causes | 62 | at least 100: not met |
| Audit | `audit.md` absent on this branch (the stats-v2 audit judged the old bank: all four checks fail) | required |

Batch 6 moved the numbers: a degenerate item now asks the RangeError to name the argument, so a function whose message does not name it is one more cause. Every pilot row was remeasured against the statistics package of its own commit.

Later batches (7 and 8 in [NEEDS.md](NEEDS.md)) added 178 exact-value, accuracy and branch items. Every one passes on the product, so none enters the pilot rows that `--hardness` reads: the table above stays the measurement of the bank the pilot ran on (651 items), and the recorded bar above is met on it. The bank now has 834 items.

What the audit findings now measure:

* Cheater attempt 1, the blanket non-finite guard: a net loss of 6 items (1 gained, 7 broken), where it gained 45.
* Planted bugs: the five the audit missed each turn their own item red.
* Causes: each names the failure a reader sees.

## The 62 failing causes, by family

| Family | Causes | Failing items | What they are |
|---|---|---|---|
| degenerate (domain, empty, nonfinite, single-equal) | 40 | 109 | per function, a RangeError that does not name the argument; special functions without the scipy limit; four wrong answers on one or all-equal values |
| missing-method | 7 | 55 | clusteredMeanInterval, designEffectFromData, iccOneWay, kishEffectiveSize, oneWayAnova, stratifiedMean, weightedMean are missing |
| product | 6 | 16 | campaign plan MDE and rho (3 causes), estate sessionRate, early stop, report run pass interval coverage |
| numerical-stability | 4 | 5 | |
| edge-accuracy | 3 | 6 | designEffect below its bound, mde at a baseline of 0 or 1, zeroFailureBound at a tiny p |
| allocation-bruteforce | 1 | 11 | neymanAllocation rounding |
| unseen-known | 1 | 3 | chaoCoverage just above the class count |

A cause can appear in more than one degenerate family, so the degenerate row counts distinct causes over the four.

## Real product defects: the executor picks these first

The validator found these defects. They are not test artifacts: each one changes a number a user reads.

1. **The report's run pass interval is too narrow.** The scorecard prints a 95 percent interval on each mode's run pass rate, a cluster bootstrap over specs. With 6 specs of 5 repeats (the Acme example's size, rho 0.3) it holds the true rate in about 82 percent of draws. With 20 specs of 3 repeats it holds it in about 92 percent. Items: `simulation.report-run-pass.s6x5` and `.s20x3`. File: `packages/report/src/estimate.ts`.
2. **`campaign plan` uses its own MDE formula.** For the 6 Acme specs with 5 repeats at a 90 percent baseline it prints 21.7 points, where `stats.mde` gives 30.9. With one spec it gives 198.1 points, where `stats.mde` finds no detectable drop. It also has no input for a measured rho. Items: `planned.plan-mde.*`, `planned.plan-rho.*`, `planned.plan-cli.*`. Files: `packages/core/src/runner/campaign.ts`, `packages/cli/src/commands/campaign.ts`.
3. **`mde` throws at a baseline pass rate of 0 or 1.** A pilot where every run passes has a baseline of 1. The documented equation then gives an effect of 0.142 for 50 specs, and no effect (null) at a baseline of 0. Items: `edge.mde.baseline-all-pass` and `edge.mde.baseline-all-fail`. File: `packages/stats/src/power.ts`.
4. **`designEffect` accepts rho below -1 / (m - 1).** `designEffect(10, -0.5)` returns -3.5 and `effectiveSampleSize(100, 10, -0.2)` returns -125. `mde` then returns an effect near 0 from a negative effective sample. Items: `edge.rho-bound.*`. File: `packages/stats/src/intervals.ts`.
5. **`zeroFailureBound` loses precision for a tiny p.** At p 1e-9 it returns 2995732357 runs, where 2995732273 is exact: `log(1 - p)` loses digits that `log1p(-p)` keeps. Item: `edge.zeroFailureBound.p1e-09`. File: `packages/stats/src/intervals.ts`.

Then the planned capabilities that docs pages name: the estate session as the unit (`sessionRate`, docs/estate.md section 7) and the early stop (docs/concepts/run-modes.md).
