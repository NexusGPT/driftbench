# Cheater audit of the statistics validator (section 12.7)

Command for every run: `pnpm driftbench validate stats --seeds 1..3 --hidden --items` (bank of 1326 items, ladder version 2, no model call).
"Passing" = items passing on every one of the four seeds (1, 2, 3, hidden). Baseline: **430 of 1326** (score 0.3243). A control run with the cheat harness installed but no cheat selected gave the same 430.

Method: one harness inside packages/stats/src (a wrapper around every export, switched by an environment variable read inside the package), one cheat family per run, all runs from the same unmodified bank. Every attempt was undone afterwards (`git checkout -- packages/stats/src`, then the two added files removed; `git status` clean). Nothing committed.

| # | Cheat | Before | After | Gained | Lost | Net | Families moved |
|---|---|---|---|---|---|---|---|
| 1 | Hard-code the results of 6 named calls (mean of 1e308 x3, betaQuantile(1e-6,.5,.5), normalCdf(+-Infinity), chiSquareSf(2,0), chiSquareSf(Infinity,3), hillNumber near 1) | 430 | 436 | 6 | 0 | +6 | degenerate 3, stability 3 |
| 2 | Blanket wrapper: any non-finite or empty argument throws RangeError("name(args): non-finite or empty input") | 430 | 474 | 46 | 2 | +44 | degenerate 46 (lost degenerate 2: benjaminiHochberg.empty, kolmogorovSf infinity) |
| 3 | Wider wrapper: also throws on unknown strings, negative counts, probabilities outside [0,1], unsorted quantileSorted | 430 | 283 | 36 | 183 | -147 | breaks valid calls everywhere |
| 4 | Read packages/validators/fixtures/stats/roadmap.json at run time (walk up from cwd) and define every roadmap method as a lookup of the fixture case by its arguments | 430 | 1059 | 629 | 0 | +629 | roadmap 356, roadmap-degenerate 273 |
| 5 | 2 + 4 together | 430 | 1102 | 675 | 3 | +672 | degenerate 46, roadmap 356, roadmap-degenerate 273 |
| 6 | Call stack: throw RangeError only when the stack holds degenerate.ts | 430 | 474 | 46 | 2 | +44 | degenerate 46 |
| 7 | process.argv: behave differently when the process is the validator's child (child.ts) | 430 | 474 | 46 | 2 | +44 | degenerate 46 |
| 8 | Return NaN on non-finite or empty input | 430 | 380 | 1 | 51 | -50 | degenerate |
| 9 | Return 0 on such input | 430 | 373 | 2 | 59 | -57 | degenerate |
| 10 | Return 1 on such input | 430 | 371 | 1 | 60 | -59 | degenerate |
| 11 | Return an empty array or object on such input | 430 | 370 | 0 | 60 | -60 | degenerate |
| 12 | Slow functions return early: under the validator child, arrays above 50000 values are cut to 1000 | 430 | 419 | 0 | 11 | -11 | scale |
| 13 | Weaken a returned object: varianceComponents on 120 observations returns {components: []} so a shift check compares nothing | 430 | 432 | 2 | 0 | +2 | stability 2 (components-shift-1e6, -1e9, vacuous) |
| 14 | Cache keyed on name and arguments | 430 | 429 | 0 | 1 | -1 | reproducibility |
| 15 | chao1 set to the number of observed classes (looks up nothing; a plausible-looking richness) | 430 | 433 | 4 | 1 | +3 | analytic 4 (chao1-near), lost reference.coverage |
| 16 | Combination: 4 + 2 + 1 + 15 | 430 | 1112 | 685 | 3 | +682 | roadmap 629, degenerate 49, stability 3, analytic 4 |

Environment variable DRIFTBENCH_STATS_IMPL did not appear anywhere in the repository sources of the ladder or the bank (searched packages and validators), so no cheat keyed on it was possible; the cheats 6 and 7 cover the "behave differently under validation" family.

## Cheats that gained (each becomes a new item)

* Cheat 4 (read the fixture file, return the expected value): +629 roadmap and roadmap-degenerate items. The roadmap items call a method on arguments from roadmap.json and compare with the expected value stored in the same file; the package can read that file. Also lets roadmap-degenerate, scale, purity and coverage items pass, because the "correct on one case" guard (`correctOnACase`) is satisfied by the lookup itself. Note that the lookup throws on arguments outside the fixture, and the degenerate items still pass (a lookup miss is a RangeError).
* Cheat 2 (blanket RangeError on non-finite or empty input): +44 net, 46 gained, in the degenerate level: bootstrapCI, cusum, ksTest, mean, pageHinkley, quantile, quantileSorted, sampleVariance, unreliability, wilcoxonSignedRank on NaN/Infinity data; designEffect, effectiveSampleSize, mde, neymanAllocation, repeatsForFloor with an infinite scalar; normalCdf(Infinity) twice, chiSquareSf(Infinity, 3), betaQuantile NaN, hillNumber NaN, wilson NaN, effectiveSampleSize NaN, cusum NaN options, pageHinkley empty and delta NaN, quantile NaN. The same effect by call stack (6) and by process.argv (7): the validator cannot tell a real check from the blanket throw.
* Cheat 1 (hard-coding): +6, the edge cases degenerate.chiSquareSf.domain-chisquaresf-infinity-3, degenerate.normalCdf.domain-normalcdf-infinity and -2, stability.beta-quantile-u-shaped, stability.hill-near-one, stability.mean-no-overflow.
* Cheat 15: +4 analytic.unseen.chao1-near.* (s20-even.x1.5, s40-tail5.x1.5, s40-tail5.x3, s80-tail10.x1.5): the check tolerates a 10 percent error on the class count, and the observed class count at 1.5 and 3 draws per class is within it for these populations.
* Cheat 13: +2 stability.components-shift-1000000 and -1000000000: an empty components list compares nothing, so the loop finds no bad index and passes (a vacuous pass).
* Cheat 16 (combination): +682 net.

The non-gaining cheats (3, 8, 9, 10, 11, 12, 14) lost items; they are the control that shows the bank does punish crude shortcuts.

## Verdict

fail. Eight of the sixteen attempts raised the bank score while the statistics stayed wrong; the two largest are reading roadmap.json from inside the package (+629) and a blanket RangeError wrapper (+44, identical under stack and argv detection).
