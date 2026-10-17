# Validator constants

This file records the numbers the validators judge by that are not derived from a seed: what each number is, where it lives in the code, how it was derived and the runs behind it. Change a number here and in the code in the same commit, on a fix/ branch with an independent review (docs/validators.md section 12).

## Generator scale

The time items `scale.10x.time` and `scale.100x.time` (docs/validators.md section 3.1). The code is in `packages/validators/src/ladders/generator/scale.ts`.

| Constant | Value | What it is |
|---|---|---|
| `SCALE_REFERENCE_UNIT_MS` | 35 | the reference unit's CPU time, in ms, on the host the second budgets were set on |
| `SCALE_BUDGET_UNITS[10]` | 857 | the 10 times budget in units: floor(30000 / 35) |
| `SCALE_BUDGET_UNITS[100]` | 1714 | the 100 times budget in units: floor(60000 / 35) |
| `SCALE_MIN_UNITS` | 10 | the fewest unit samples in the window that measure anything |
| `SCALE_BUDGET_MS` | 60000 at 10 times, 120000 at 100 times | unchanged: the wall-clock cap is 10 times this |

### How they were derived

* The second budgets, 30 s for the two runs at 10 times and 60 s at 100 times (half of `SCALE_BUDGET_MS`), are the earlier budgets. The unit budgets keep them on a host where the unit takes 35 ms. Where the unit costs more, the second budget is larger by the same factor, and where it costs less, smaller.
* 35 ms is the unit's cost on an Apple M4 Pro with 12 cores (8 fast, 4 efficient), shared with other jobs, at a load average of 28 to 130. Across 30 scale windows beside the sampler (14 experiment rounds of a 10 times and a 100 times window, and 2 runs of the real scale child at 100 times), the unit's median or mean per window was 30.0 to 44.7 ms. 35 ms is near the middle of the runs at 100 times, where the means were 32.0 to 40.2 ms. The CI runner's figure is in the pull request that set these numbers.
* The minimum is 10 samples. A clean 10 times window on that host took 4.7 to 8.5 s of CPU, and the sampler gave 30 to 87 samples in it. With fewer than 10, a few slow units decide the mean.

### Runs behind them

The scale window at 100 times the behaviours of seed 1, beside the sampler, on the host above. The experiment harness rows ran the product of main `7a712b6`; the real scale child rows ran main `183abfd` with this measure:

| Product | CPU ms | Units (window CPU ÷ unit) | Verdict at 1714 |
|---|---|---|---|
| clean, 10 runs of an experiment harness, load 33 to 130 | 47411 to 59672 (26% spread) | 1526 to 1679 by the median unit; 1460 to 1557 by the mean, 6 of the runs | pass |
| clean, the real scale child, mean unit | 67733 | 1683 | pass |
| slower host: every CPU time read three times the real one, in the child and the sampler | 187541 | 1667 | pass |
| twice as slow: each generation spends its own CPU again | 96888 | 2527 | fail |
| twice as slow, the experiment harness, median unit, 2 runs | 93540 to 100477 | 2458 to 2560 | fail |
| quadratic: 0.033 µs × specs squared after each generation, 2 runs of the experiment harness | 129066 to 131616 | 3676 to 3729 | fail |
| quadratic, same constant, the real scale child | killed at the wall cap of 1200 s | 0 samples | fail |
| quadratic: 0.012 µs × specs squared after each generation, the real scale child | 97112 | 2379 | fail |

The growth from 10 to 100 times, measured in the same process, was tried as the measure and rejected. It does not catch a product twice as slow, since both sizes slow down alike: clean growth was 6.5 to 11.1 and the twice-as-slow product's 7.5 to 9.1. A slack of 4 times the multiple, as in the blocks scale family, is 40, and the quadratic product above grew only 14.8 to 18.0.
