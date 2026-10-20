# Stats validator: where the gate stands

## Interim stage, not the gate

The bar below is an interim stage that lets the statistics validator land on `release/next`. The gate for this validator is section 12.4 unlowered: score after the pilot at most 0.4, forecast at least 100, at least 100 distinct failing causes, and `audit.md` with four passes. The row stays open until that gate holds. The measurement below is of the 904-item version 3 bank; the bank on this branch has since gained the capabilities level and the weights work, so a fresh pilot and a fresh audit are owed.

## Ladder version 4: the weights family

Version 4 adds the 187 items of the weights family to the bank of version 3 and #771's capabilities level (1353 items in all after the merge). The recorded bar below stays the one of version 3 until the version 4 pilot is measured: the independent blind pilot reads the failing list of the whole bank, and `driftbench validate stats --hardness` prints the score, the forecast and the distinct causes it measured. The audit of the family (four checks, round 2) is pending in [audit-weights/audit.md](audit-weights/audit.md), so the gate is not met. The floor of version 4 is 3, the level the repository's own `packages/stats` reaches under ladder version 4 on the merged eight-level ladder (this PR with #771). It was measured with `driftbench validate stats --seeds 1..20 --hidden --json` at commit `c4a75b2aa` (hidden seed 300302186 is derived from it): level 3 of 8 on every one of the 21 seeds (1 to 20 and hidden). `reference`, `degenerate` and `reproducibility` pass at 1; `analytic` stops at 0.9984 on seed 1, with 1 item failing. The evidence block of `validators/floors.json` is that run. Earlier measurements (the seven-level ladder at `d356da628`, and the eight-level ladder at `e7cc124fb` before the weights items moved to `capabilities`) also gave 3. The floor guards the repository's product against regression, not the audit pilot's private package (`mixtureWeights` and `mixedStrengthCoverage` are not in the repository).

Where the weights family belongs: `mixtureWeights` and `mixedStrengthCoverage` are functions the package lacks, so the 49 weights-mixture and 41 weights-coverage items sit at the `capabilities` level; the agreement and Wilson items test functions the package has and sit at `analytic`. Only the level field of those 90 items changed; no item content did.

The floor drops from 7 (ladder version 2) to 3 (ladder version 4). That is acceptable only because version 4 is a harder bank: version 3 added 46 items for defects and for statistics the docs define and the package lacks, and version 4 adds the 187 items of the weights family, whose functions the package also lacks. A floor belongs to one ladder version, so the 7 stays in `validators/floors.json` as the history of version 2; the stats-fix pull requests raise the floor again as they land.

## Ladder version 3: the recorded bar

Max score after the pilot: 0.85
Min forecast: 9
Min distinct failing causes: 80

The owner's fallback, verbatim: "If you cannot do it, lower the bar per validator". The lead recorded this bar for ladder version 3 after the blind pilot below, with the reason below.

### The measurement

The pilot is blind: a fresh executor, given only the stripped failing-item list, repaired the iteration-0 copy of `packages/stats` (commit `141a67d8`) for ten iterations. The starting package is that copy, loaded through `DRIFTBENCH_STATS_IMPL`, because `main` already holds the fixes of the earlier iterations and an executor on `main` has no failing items to read; the CLI and the other packages were at `main`. The bank is the 904 items of this branch. The rows are the `executor: blind` rows of `journal.jsonl`; the commits are on `pilot/stats-v3-blind`.

| Measure | Value | Section 12.4 | Recorded bar |
|---|---|---|---|
| Bank at the version 3 pilot | 904 items, 22 families, tiers 1 to 5 | 300 items: holds | |
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

The owner's fallback, verbatim: "If you cannot do it, lower the bar per validator". The lead ruled this bar for the statistics validator on 2026-10-18; it is the bar PR 857 records for ladder version 3, with its measurement and reason (`docs/validators.md` section 12.9 there). A bar lowers only the terms of section 12.4; the independent audit of section 12.7 is not lowered, and its four checks are pending for this bank ([audit.md](audit.md)).

## Current gate review, 2026-10-18 evening

The gate is **not met**: the audit is pending. The bank has 1166 items: the 928 earlier items (the 922 below and six clopperPearson extreme-alpha items) and 119 new capabilities the package does not have (238 items, one cause each, defined in `docs/statistics/`). The 27 new capabilities that repeated roadmap methods were left out, so no cause counts twice. A domain item now also requires the function to accept its valid cases: a library that throws a `RangeError` on every call passes none of them. Each of the 119 functions has a values item that fails on a 0.2 percent nudge and on a throw, and a domain item that fails on a throw ([evidence](evidence/newcaps-sensitivity.md)).

The new capabilities form the last level of the ladder, `capabilities` (level 8), so a missing capability never hides a regression in levels 1 to 7, and the floor of 7 keeps its meaning. Two classification functions (`youdenIndex`, `markedness`) were added after the pilot so that no family is under 20 items.

| Inventory | Value | Section 12.1 |
|---|---|---|
| Bank | 1166 items, tiers 1 to 5 | 300 items, no family under 20, every tier: holds |

Pilot rounds 11 to 20 ran on the bank before those two functions (1162 items, bank hash `eff677df`), from the product of the earlier pilot's round 10 ([evidence](evidence/pilot-rounds-11-20.md)):

| Measure | Rounds 11 to 20 | Section 12.4 contract | Recorded bar above |
|---|---|---|---|
| Forecast | 216 / 1.9 = 113.7 iterations | At least 100: **holds** | At least 9: **holds** |
| Score after the pilot | 946 / 1162 = 0.8141 | At most 0.4: **fails** | At most 0.85: **holds** |
| Distinct failing causes | 108 | At least 100: **holds** | At least 80: **holds** |
| Independent audit | four checks pending | **Not met** | **Not met** (not lowered) |

The contract's score term fails because 927 items already pass on the pilot's product; the recorded bar holds on all three terms. The pilot ran from the feed in an executor folder, not as the blind pilot of section 12.7. The journal is unchanged: its rows describe the historical 651-item bank, and the pilot's referee rows are in the evidence folder.

## Earlier gate review, 2026-10-18 morning

The gate is **not met**. The expanded bank has **no fresh pilot**. The journal still measures the historical 651-item bank, not the current bank. No historical row is relabelled or given a new fingerprint.

This review stacks PR 743 (`ff414718c`), PR 744 (`4e317a4d`, including the compiled-child follow-up to `68e1bc046`) and PR 749 (`25f32ea12`) on main. It adds real capabilities before considering a provisional bar: six items for family coverage simulation and custom-statistic cluster bootstraps. They extend `exact-estimators`, with three shared implementation causes, and preserve every existing item and cause. See [NEEDS.md](NEEDS.md#batch-12-documented-capabilities-before-the-gate-review).

PR 777 (`36b4abe6d`) supplies the product capabilities and numerical repairs before this validator branch lands. Correctness runs reach level 7 with zero failing items on visible seeds 1, 2 and 3 and hidden seed 119902070. These runs do not replace a fresh hardness pilot or any independent audit.

The live bank grows from 904 to 910 items. Every family has at least 20 items and tiers 1 through 5 are present. Those are bank inventory measurements, **not** a fresh pilot, a new forecast or a measured count of failing causes.

## Extreme-alpha review follow-up

The current bank has 922 items. Twelve new cases check six normal-quantile callers at `Number.MIN_VALUE` and `1e-300`, using independent 100-digit log-erfc references. They share one cause; no existing item, cause, tolerance or floor changes. Product PR 777 at `dbfede4b2` repairs the six callers.

A fresh seed-1 `--items --json` run passes all 922 items at level 7. The measured bank hash is `f7aa0436f8bf4e387b557c054ae550e350bddc79304df6b0a945ee2604ebd4e0`. A subsequent run on seeds 1 through 20 and the hidden seed at `c68c2ab0c` also passes all 922 items at level 7 on every seed. These are correctness runs, not the requested ten-round pilot. The historical comparison below stays unchanged.

## Both bars against the same historical journal

`pnpm driftbench validate stats --hardness` reads `journal.jsonl`. Its builder pilot contains iterations 0 through 10, all on 651 items. The baseline is 418 passing; iteration 10 has 446 passing. The mean improvement is `(446 - 418) / 10 = 2.8` items per iteration. The forecast is `(651 - 446) / 2.8 = 73.2142857` iterations. There are no blind pilot rows. The latest row, iteration 42, records 651 passing; it does not replace the pilot-end measurement.

| Measure | Historical 651-item pilot | Section 12.4 contract | Existing stats provisional bar |
|---|---|---|---|
| Forecast | 73.21 iterations | At least 100: **fail** | At least 70: **pass** |
| Pilot score | 446 / 651 = 0.6851 | At most 0.4: **fail** | At most 0.7: **pass** |
| Distinct failing causes | 62 at iteration 10 | At least 100: **fail** | At least 60: **pass** |
| Current bank identity | Historical rows have no bank hash | **Unverified** | **Unverified** |
| Independent audit | All four current-bank checks pending | **Not met** | **Not met** |

The expanded 910-item bank has no measured pilot score, forecast or pilot failing-cause count. Passing capability tests do not supply those measurements. Neither column licenses merging this bank.

## The earlier provisional bar (history)

The bar before 2026-10-18 evening: score after the pilot at most 0.7, forecast at least 70, at least 60 distinct failing causes. These were the per-validator provisional terms, retained rather than lowered again. Their original reason is the historical forecast of 73.21, score of 0.6851 and 62 failing causes. They describe what the historical pilot meets, not what the expanded bank meets. The owner requires capability additions first; the six additions above satisfy that order without padding causes or changing the global contract. A fresh matching-bank pilot and independent audit remain necessary before any current-bank gate claim.

The hardness command compares the live bank fingerprint with the journal rows. A mismatched fingerprint is stale; a missing fingerprint is unverified. Both block the gate while preserving the historical figures for inspection. The journal remains unchanged. [audit.md](audit.md) records the four pending checks, and [the evidence report](evidence/gate-review.md) records tests and per-export mutation witnesses.

## Historical pilot: the 62 failing causes, by family

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

## Historical defect list from the earlier pilot

This earlier pilot recorded these defects; this list is historical, not a claim that they remain open in the current product. The validator found these defects. They are not test artifacts: each one changes a number a user reads.

1. **The report's run pass interval is too narrow.** The scorecard prints a 95 percent interval on each mode's run pass rate, a cluster bootstrap over specs. With 6 specs of 5 repeats (the Acme example's size, rho 0.3) it holds the true rate in about 82 percent of draws. With 20 specs of 3 repeats it holds it in about 92 percent. Items: `simulation.report-run-pass.s6x5` and `.s20x3`. File: `packages/report/src/estimate.ts`.
2. **`campaign plan` uses its own MDE formula.** For the 6 Acme specs with 5 repeats at a 90 percent baseline it prints 21.7 points, where `stats.mde` gives 30.9. With one spec it gives 198.1 points, where `stats.mde` finds no detectable drop. It also has no input for a measured rho. Items: `planned.plan-mde.*`, `planned.plan-rho.*`, `planned.plan-cli.*`. Files: `packages/core/src/runner/campaign.ts`, `packages/cli/src/commands/campaign.ts`.
3. **`mde` throws at a baseline pass rate of 0 or 1.** A pilot where every run passes has a baseline of 1. The documented equation then gives an effect of 0.142 for 50 specs, and no effect (null) at a baseline of 0. Items: `edge.mde.baseline-all-pass` and `edge.mde.baseline-all-fail`. File: `packages/stats/src/power.ts`.
4. **`designEffect` accepts rho below -1 / (m - 1).** `designEffect(10, -0.5)` returns -3.5 and `effectiveSampleSize(100, 10, -0.2)` returns -125. `mde` then returns an effect near 0 from a negative effective sample. Items: `edge.rho-bound.*`. File: `packages/stats/src/intervals.ts`.
5. **`zeroFailureBound` loses precision for a tiny p.** At p 1e-9 it returns 2995732357 runs, where 2995732273 is exact: `log(1 - p)` loses digits that `log1p(-p)` keeps. Item: `edge.zeroFailureBound.p1e-09`. File: `packages/stats/src/intervals.ts`.

Then the planned capabilities that docs pages name: the estate session as the unit (`sessionRate`, docs/estate.md section 7) and the early stop (docs/concepts/run-modes.md).
