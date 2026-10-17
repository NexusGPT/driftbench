# Blind pilot: validator stats

Executor: Sonnet 5.5, given only `driftbench validate stats --brief --fresh`, on branch `audit/stats-blind-pilot` (head `8b5a5304`, 20 commits: a fix and a journal row per iteration). Ten pilot iterations, journal rows 1 to 10 with `"executor": "blind"`.

## Result

* Verdict: pass. Ten iterations done, items fixed in every one.
* Items fixed per iteration (genuine fixes, counted by hand from the item ids that turned green; seed-drawn items that flickered with the hidden seed are left out): 23, 6, 4, 3, 4, 2, 4, 3, 3, 2. Total 54, mean 5.4.
* Bank items passing on every seed, seeds 1, 2 and hidden (the per-iteration runs): 432 before, 455, 461, 465, 469, 472, 475, 477, 481, 484, 485 after iterations 1 to 10. The raw net gain is 53 (the 54 genuine fixes less one flickering seed-drawn item).
* Full run, seeds 1 to 20 and hidden, on the head: 426 before the pilot, 482 after, of 1326 (0.321 to 0.364).
* Level: 1 of 7 on every seed, before and after. Level 2 (`degenerate`) went from 0.6866 to 0.9552 of its items. Levels 4 and 6 did not move; level 7 is at 0.
* The builder's pilot fixed 44 items in ten iterations on the 1201-item bank (466 against 422). Mine fixed 54 on the 1326-item bank. The first iteration is the outlier (23 items from one shared helper); without it the mean is 3.4.

## Per iteration (component, cause, items passing before and after on seeds 1, 2, hidden, minutes)

| It | Component | Cause | Passing | Min |
|---|---|---|---|---|
| 1 | basics.ts mean, quantile, quantileSorted, sampleVariance | no finiteness, order or NaN-level check; one shared helper `assertFiniteValues` (one cause, 23 items incl. unreliability, bootstrapCI, cusum) | 432 to 455 | 34 |
| 2 | drift.ts pageHinkley | no input check (empty, non-finite, bad options) | 455 to 461 | 12 |
| 3 | drift.ts ksTest | NaN loops for ever, infinite value gives a p-value, unknown method accepted | 461 to 465 | 5 |
| 4 | paired.ts wilcoxonSignedRank | no finiteness check | 465 to 469 | 3 |
| 5 | intervals.ts designEffect, effectiveSampleSize | infinite m, infinite or NaN n accepted | 469 to 472 | 3 |
| 6 | basics.ts mean | all-equal sample not returned exactly (0.6 x 10 gave 0.5999999999999999) | 472 to 475 | 2 |
| 7 | special.ts normalCdf, normalSf, chiSquareSf | NaN at infinite argument, df 0 accepted | 475 to 477 | 2 |
| 8 | special.ts logGamma, incompleteBeta, betaQuantile | pole, x above 1, NaN level | 477 to 481 | 3 |
| 9 | drift.ts cusum | sd infinite, k negative, h NaN, bad warmup or target accepted | 481 to 484 | 2 |
| 10 | intervals.ts wilson | z NaN, zero or negative accepted | 484 to 485 | 3 |

Minutes: iteration 1 includes the baseline full run (the baseline 21-seed run took about 66 minutes of wall time under heavy load); later iterations ran on a quiet machine. Iteration 2's 12 minutes counts from a clock file I wrote before the run was started; treat as approximate. Iterations 2 to 10 scored seeds 1, 2 and hidden only (a full 21-seed run took 12 to 66 minutes depending on load); the end state was scored once on all 21 seeds.

## What in the brief was unclear

* The stop rule says to stop after three iterations with no level change. The level is the first failing level over all seeds, and level 2 holds 200+ items that all have to pass, so the level stayed at 1 for all ten iterations while items were fixed every time. I read the rule as a stuck rule about items, not levels, and continued, as the task told me. Either the rule should count items fixed, or the brief should say levels move rarely at the start.
* The brief says to commit "with the ladder table in the message" but does not say where the table comes from; I used a short before/after of the per-level shares from the `--items --json` run.
* The `--items --json` output on 21 seeds is 32 MB and starts with a pnpm banner line, so it does not parse as JSON until the first `{`; the end holds `ELIFECYCLE` text when the exit code is not 0. A `--quiet`, or running `tsx` directly, would help. I wrote a small script to build the journal row (levels per seed, shares per level, family counts) from this JSON, since the brief lists the fields but not how to derive "metrics" from the items.
* The brief says the journal row carries `failingCauses` and `failingWithoutCause` "from the `bank` of the `--items --json` run"; true for the full run, but when I scored a seed subset (to save time) the bank block is the subset, so the row is consistent with its own `seeds`. The schema checks this (perSeed must hold the listed seeds), which worked well.
* "Red test first": for a NaN that loops for ever (ksTest) the red test would hang; I wrote test and fix in the same edit for iteration 3 and say so here. Iterations 1, 2, 4 to 10 were seen red first.
* The brief names `packages/stats/test/degenerate.test.ts` for tests, but that file does not exist in the starting tree; the handover says "write the test in" it. I created it.

## What surprised me in the validator

* The hidden seed is derived from `git rev-parse HEAD`, so every commit changes it. Seed-drawn items then appear and disappear between runs with no code change: `analytic.allocation.neyman-optimal.N` (appeared in iterations 2, 7 and 10, vanished in 3 and 8), `degenerate.*.equal` (bootstrapCI, sampleVariance), `analytic.unseen.chao1-near.*`. On the full 21-seed run, 11 `allocation-bruteforce` items still fail and are a real defect in `neymanAllocation` on some inputs; I did not touch it. A per-iteration "newly failing" list therefore contains noise after every commit; I excluded those from my fix counts.
* Fixing a shared helper (iteration 1) cleared 23 items, 14 of which belong to other functions that call it. The bank counts them as separate items but they share a cause, as the brief warns.
* The first full run took over an hour under load (the machine's load average was above 100); item timeouts (120 s) did not fire spuriously.
* Level 4 (`analytic`) share moved from 0.9405 to 0.9351 to 0.9243 across runs only through the hidden-seed items above, never through my fixes.

## Files

* Branch: `audit/stats-blind-pilot` (pushed). Fixes in `packages/stats/src/{basics,drift,intervals,paired,special}.ts`, tests in `packages/stats/test/degenerate.test.ts` (32 tests, all green; the whole package: 94 tests green).
* Rows: `validators/stats/journal.jsonl`, the last ten lines, `"executor": "blind"`.
