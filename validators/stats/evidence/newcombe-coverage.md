# Newcombe coverage investigation

The implementation under-covered at n=30. The validator bar stays unchanged.

## Measurement

The script `tools/stats/newcombe-coverage.ts` calls the actual `rateItems()` checks.
It observes their RNG streams and returned intervals without changing any draw,
input, method or threshold. It asserts its coverage count agrees with each item's
pass/fail result. Seeds 1 through 256 each use 2000 draws, giving 512000 intervals
per sample size and implementation. The historical failure seed 362983924 runs
separately and does not enter the distribution estimates.

The baseline is commit 9970c938. `newcombe-summary.json` records source digests,
measurement times, Node version and pooled Wilson confidence limits.
`newcombe-seeds.csv` contains every before/after count.

| n | Version | Covered / draws | Mean | Seed SD | Min | P05 | Median | P95 | Max | Failed seeds / 256 |
|---|---|---|---|---|---|---|---|---|---|---|
| 30 | Before | 484591 / 512000 | 0.9464668 | 0.0048079 | 0.9325 | 0.9385 | 0.9465 | 0.954125 | 0.9630 | 1 |
| 30 | Corrected | 493591 / 512000 | 0.9640449 | 0.0041754 | 0.9505 | 0.9575 | 0.9645 | 0.9705 | 0.9765 | 0 |
| 100 | Before | 486083 / 512000 | 0.9493809 | 0.0047203 | 0.9345 | 0.941875 | 0.9495 | 0.95675 | 0.9640 | 1 |
| 100 | Corrected | 489257 / 512000 | 0.9555801 | 0.0043167 | 0.9445 | 0.948875 | 0.9555 | 0.9630 | 0.9695 | 0 |

The original n=30 pooled 95% interval is [0.9458469, 0.9470800], below 0.95.
The gap is 11.23 estimated Monte Carlo standard errors. Corrected n=30 coverage
has pooled 95% limits [0.9635315, 0.9645514]; corrected n=100 has
[0.9550123, 0.9561410]. These estimates concern the bank's mixture of paired
populations, not a guarantee of minimum coverage at every possible population.

The historical seed reproduces 1866/2000 at n=30 before the fix and gives
1912/2000 afterwards. At n=100 it changes from 1916/2000 to 1923/2000.
Seed 132 fails n=30 before the fix; seed 101 fails n=100. Both pass afterwards.

## Cause and reference

Let a, b, c and d be both-pass, regressed, improved and both-fail counts.
The implementation combined Wilson limits using raw phi:

```
C = a*d - b*c
phi = C / sqrt((a+b)*(c+d)*(a+c)*(b+d))
```

Newcombe's method 10 first replaces positive C with `max(C - n/2, 0)`.
Negative C stays unchanged. A zero marginal product gives phi = 0.
The Wilson limits themselves have no continuity correction.
Omitting the covariance correction makes positively associated arms' difference
intervals too narrow. A balanced fully concordant table even gets zero width.

Independent reference implementations agree:

- [statsmodels paired interval, pinned source](https://github.com/statsmodels/statsmodels/blob/35a8e0b7483211f5be7e60926be082136263cac3/statsmodels/stats/proportion.py#L1765).
- [ratesci moverpairci, pinned source](https://github.com/cran/ratesci/blob/4bd68ccb523ea699c2828b9b4cd9e96d83d2d443/R/moverpairci.R#L193).
- [Newcombe's paired-data paper](https://doi.org/10.1002/(SICI)1097-0258(19981130)17:22%3C2635::AID-SIM954%3E3.0.CO;2-C).

`packages/stats/test/reference/make_newcombe_fixtures.py` executes the pinned,
digest-checked statsmodels function without rewriting its arithmetic. Its output
uses the installed statsmodels Wilson helper. Twelve reference cases cover
positive, small-positive, zero and negative covariance, zero margins, balanced
and unbalanced concordance, and different confidence levels. Tests also swap
the arms and check the reversed limits.

The old Python fixture generator duplicated the missing correction. Its paired
interval and non-inferiority bounds are corrected; other fixture groups remain
unchanged. The historical first miss, table [2,5,0,23], has corrected limits
[0.0125352, 0.3332326], covering its planted truth 0.0218.

## Why the bar does not change

The documented bar is `0.95 - 3*sqrt(0.95*0.05/2000) = 0.9353798084827865`.
This is a three-standard-error rule, approximately a one-sided 0.135% normal
tail, not an exact binomial false-alarm calibration. Failure means at most
1870 covered draws. At true coverage 0.95, its exact binomial probability is
0.00177582625. At the old empirical coverage 0.9464668, it is 0.01480688107.
The latter is a plug-in estimate, not a measured failure frequency.

The sweep rejects the premise that the old method attains 0.95 coverage on
these designs. Lowering the bar would hide that defect. No validator item,
population, draw count, threshold, floor or bank is changed.

## Reproduction and tests

```
pnpm exec tsx tools/stats/newcombe-coverage.ts > coverage.json 2>&1
pnpm exec vitest run packages/stats/test packages/validators/test/stats-newcombe.test.ts --maxWorkers=2
pnpm -s driftbench validate stats --seed 362983924 --check-floor --json
```

Before the source fix, the new reference and regression-seed tests give 15
failures and 12 passes. After the fix, the stats suite and seed regressions give
188 passes. Report integration and selected stats validator tests give 101
passes. The reference comparisons use fixed independent limits; they do not
recalculate the implementation's own formula as their expected answer.

The full statistics ladder reaches level 7 of 7 on historical seed 362983924,
with every level's observed score equal to 1 and `--check-floor` passing.
Repository lint, typecheck and the leak guard also pass. Lint reports existing
warnings outside this change.
