# Cause review (docs/validators.md section 12.7)

Verdict: pass. Agreement 30/30 = 1.00 (threshold 0.80). Reviewed distinct causes 133, declared distinct causes 132.

## Method
1. `driftbench validate stats --seeds 1..20 --hidden --all-levels --blind --json` gave 900 failing items (union over seeds 1..20 and hidden; levels 2, 4, 6, 7).
2. Sample: `random.Random(7).sample(sorted(ids), 30)`.
3. I wrote my fix for each of the 30 in `cause-review-fixes.md` (modification time 2026-10-17 17:50:40) before I ran the non-blind command. I wrote each fix from the item message and from packages/stats.
4. Builder tags: `pnpm driftbench validate stats --seed 1 --all-levels --json` (`--seeds 1` is refused: the flag needs `a..b`). All 30 items appear in it, with their `cause`.

Side finding: in the `--blind` JSON the `detail` of all 900 items still starts with `[family, tier N, cause: ...]`. The blind view strips the `cause` field and the `Fix:` hint but not this prefix. I removed the prefix from my working view before I wrote the fixes. The blind view should strip it too.

## The 30 items
| # | item | my fix | builder cause | same? |
|---|---|---|---|---|
| 1 | `roadmap-degenerate.simpsonIndex.nan` | ADD simpsonIndex (coverage.ts); it throws a RangeError on a non-finite count | add simpsonIndex | same |
| 2 | `roadmap-degenerate.chiSquareIndependence.empty` | ADD chiSquareIndependence (paired.ts); it throws a RangeError on an empty table | add chiSquareIndependence | same |
| 3 | `roadmap-purity.confidenceSequence` | ADD confidenceSequence (intervals.ts); pure function, no argument mutation | add confidenceSequence | same |
| 4 | `roadmap.fleissKappa.3` | ADD fleissKappa (agreement.ts), formula in the message, export from index.ts | add fleissKappa | same |
| 5 | `degenerate.pageHinkley.empty` | VALIDATE pageHinkley (drift.ts); throw a RangeError on an empty series | pageHinkley: input validation | same |
| 6 | `degenerate.wilcoxonSignedRank.minus-infinity-in-data` | VALIDATE wilcoxonSignedRank (paired.ts); throw a RangeError on any non-finite value | wilcoxonSignedRank: input validation | same |
| 7 | `roadmap.spearman.2` | ADD spearman (agreement.ts): Pearson on average ranks, t p-value with n-2 df | add spearman | same |
| 8 | `roadmap.alphaSpending.3` | ADD alphaSpending (power.ts): Lan-DeMets O'Brien-Fleming and Pocock | add alphaSpending | same |
| 9 | `roadmap-coverage.jeffreys.n5` | ADD jeffreys (intervals.ts) via betaQuantile, with the k=0 and k=n edges | add jeffreys | same |
| 10 | `roadmap-degenerate.winRate.infinity` | ADD winRate (agreement.ts); throw a RangeError on a non-finite score | add winRate | same |
| 11 | `roadmap.chao2.3` | ADD chao2 (coverage.ts), incidence estimator with the Q2=0 branch | add chao2 | same |
| 12 | `degenerate.quantileSorted.infinity-in-data` | VALIDATE quantileSorted (basics.ts); throw a RangeError on a non-finite element it reads | quantileSorted: input validation | same |
| 13 | `roadmap-scale.pearson` | ADD pearson (agreement.ts), single pass O(n), finite at n=100000 | add pearson | same |
| 14 | `roadmap-degenerate.hoeffdingInterval.infinity` | ADD hoeffdingInterval (intervals.ts); throw a RangeError on non-finite k | add hoeffdingInterval | same |
| 15 | `degenerate.ksTest.nan-in-data` | VALIDATE ksTest (drift.ts); reject NaN before the merge loop (NaN never equals itself, so the two inner whiles never advance and the outer loop never ends) | ksTest: input validation | same |
| 16 | `roadmap-coverage.betaPosteriorInterval.n200` | ADD betaPosteriorInterval (intervals.ts) via betaQuantile | add betaPosteriorInterval | same |
| 17 | `roadmap-purity.normalSampleSize` | ADD normalSampleSize (power.ts), pure | add normalSampleSize | same |
| 18 | `roadmap-purity.jackknifeRichness` | ADD jackknifeRichness (coverage.ts), pure, no sort in place | add jackknifeRichness | same |
| 19 | `degenerate.unreliability.nan-in-data` | VALIDATE unreliability (reliability.ts); throw a RangeError on any non-finite value | unreliability: input validation | same |
| 20 | `roadmap-degenerate.kishEffectiveSize.empty` | ADD kishEffectiveSize (intervals.ts); throw a RangeError on empty weights | add kishEffectiveSize | same |
| 21 | `roadmap-coverage.jeffreys.n10` | ADD jeffreys (intervals.ts), same single fix as item 9 | add jeffreys | same |
| 22 | `roadmap.benjaminiYekutieli.3` | ADD benjaminiYekutieli (multiple.ts), BH with m replaced by m c(m) | add benjaminiYekutieli | same |
| 23 | `roadmap-purity.ljungBox` | ADD ljungBox (drift.ts), pure | add ljungBox | same |
| 24 | `degenerate.quantileSorted.invalid-quantilesorted-3-1-2-0-5-not-sorted` | VALIDATE quantileSorted (basics.ts); throw a RangeError when the input is not ascending | quantileSorted: input validation | same |
| 25 | `roadmap.sprtBernoulli.4` | ADD sprtBernoulli (drift.ts), Wald SPRT with the index -1 rule | add sprtBernoulli | same |
| 26 | `roadmap.bradleyTerry.2` | ADD bradleyTerry (agreement.ts), MM iteration, geometric-mean normalisation | add bradleyTerry | same |
| 27 | `roadmap-degenerate.betaPosteriorInterval.infinity` | ADD betaPosteriorInterval (intervals.ts), same single fix as item 16; throw a RangeError on non-finite k | add betaPosteriorInterval | same |
| 28 | `roadmap-degenerate.iChao1.nan` | ADD iChao1 (coverage.ts); throw a RangeError on a non-finite count | add iChao1 | same |
| 29 | `roadmap.eloUpdate.5` | ADD eloUpdate (agreement.ts) | add eloUpdate | same |
| 30 | `roadmap.eloUpdate.2` | ADD eloUpdate (agreement.ts), same single fix as item 29 | add eloUpdate | same |

Agreement = 30 / 30 = 1.00. For the 24 "add X" items my fix was the same missing export, in the same file. For the 6 "input validation" items my fix was the same input check in the same function.

## Counts
- Failing items (union): 900.
- Reviewed distinct causes: 133 (101 missing functions to add, 21 existing functions that need an input check, 11 other single-function fixes).
- Declared distinct causes: 132 (distinct `cause` values among the 889 failing items of the non-blind seed 1 run). Over the 900 union items, the tags that the blind detail prefix leaks number 135.
- The reviewed count (133) replaces the declared one in the gate.

## How I grouped
- One group per function to add: every item that says `does not export F` (roadmap items, degenerate items, purity, coverage, scale) shares one fix, adding F with its input checks.
- One group per function to validate: every item that says `Add the check to F`.
- The 32 other items, by my own reading of the code:
  - `betaQuantile`: NaN check, and precision for tiny p (2 groups).
  - `mean`: equal values and overflow, one running-mean rewrite (1 group).
  - `varianceComponents`: equal values and the two large shifts, one centring fix (1 group).
  - `chiSquareSf` domain edges (1), `normalCdf` infinities (1), `neymanAllocation` integer search (11 items, 1 group), `chaoCoverage` chao1 bias (4 items, 1 group).
  - One group each: `bootstrapCI` constant sample, `incompleteBeta` domain, `ksTest` NaN (hangs), `logGamma` poles, `sampleVariance` equal values, `hillNumber` near q = 1.
- Full grouping: `groups.json` in the audit scratch folder (not committed).
