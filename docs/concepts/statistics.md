# Statistics

One run proves nothing. driftbench repeats runs, reports every rate with an interval, and compares two versions of an agent with paired tests. The functions on this page ship in `@driftbench/stats`. Each matches a reference value computed in Python (scipy and numpy) and committed as a test fixture. Repeats and the minimum detectable effect of `campaign plan` are built, phase 1. Wiring the functions into reports, the parity verdict of a campaign, and the `stats`, `compare` and `ci` commands is planned, phase 4.

## Repeats

A campaign runs each spec several times in each mode (`--repeats`; see [running](../running.md)). With c passing runs out of n:

* pass^k is the probability that all k runs pass: `C(c, k) / C(n, k)`. This is the estimator of [arXiv 2406.12045](https://arxiv.org/pdf/2406.12045), as used by the `pass_k` reducer of inspect_ai.
* pass@k is the probability that at least one of k runs passes, with the estimator of [arXiv 2107.03374](https://arxiv.org/pdf/2107.03374).
* Unreliability is the 90th percentile minus the 10th percentile of the block score across repeats.

pass^k falls as k grows when an agent is inconsistent, even if its average looks fine.

## Intervals

* Every rate is printed with a Wilson interval.
* Anything aggregated over blocks uses a percentile bootstrap with one conversation, or one task, as one cluster. The blocks of one run are not independent samples, so no interval treats them as if they were.

## Comparing a baseline and a candidate

Both run on the same specs.

* McNemar's test on the all-pass flag per spec, exact for small counts.
* Wilcoxon's signed-rank test on the drift count per spec.
* The effect size is the difference in discordant pairs, with its interval.
* Many criteria: Benjamini-Hochberg control across criteria before any report says that a criterion regressed.

## The parity verdict

The candidate is non-inferior to the baseline when, for every gating criterion, the upper bound of the interval on the regression effect is below a margin set before the campaign, and no gating flag fires where the baseline had none. Zero regressed cells in one run is not parity: it is one draw. The report prints the margin and the discordant pair counts.

## Before a campaign

`campaign plan` prints the number of runs, the projected cost and the minimum detectable effect for the chosen repeats. If the effect is too large to be useful, the repeats go up before any money is spent. `campaign plan` treats runs as independent today. The library's `mde` takes the correlation of repeats of one conversation or one task (`rho`, measured by `varianceComponents`); using it in `campaign plan` is planned, phase 4. See [running](../running.md#the-minimum-detectable-effect).

## Over time

To watch a live agent: CUSUM and Page-Hinkley on pass rate, cost and latency, and a Kolmogorov-Smirnov test for a shift in a distribution.

## Judges

Cohen's kappa and Krippendorff's alpha measure how far judges agree with hand labels and with each other. See [judges](judges.md).

## Tasks

Task specs use the same statistics. One task is one cluster. An artifact check is a pass or a fail per repeat, so pass^k reads the same way for a workbook as for a reply.

## Functions

| Function | Computes |
|---|---|
| `wilson(k, n, z)` | the Wilson interval for k successes in n; `z` defaults to the 95 percent value |
| `clopperPearson(k, n, alpha)` | the exact interval, from the beta quantile |
| `zeroFailureBound(p, alpha)` | the smallest n with no failure that bounds a failure rate p |
| `designEffect(m, rho)`, `effectiveSampleSize(n, m, rho)` | the design effect `1 + (m - 1) rho` of clusters of size m, and the effective sample size |
| `bootstrapCI(values, { clusters, iterations, method, alpha, seed, statistic })` | a percentile or basic bootstrap interval that resamples whole clusters, seeded |
| `passK(c, n, k)`, `passAtK(c, n, k)` | pass^k and pass@k |
| `unreliability(samples)` | the 90th percentile minus the 10th |
| `mcnemar(b, c, { exact })` | McNemar's test on the discordant counts, exact below 25 discordant pairs by default |
| `wilcoxonSignedRank(x, y, { method })` | the paired signed-rank test |
| `pairedRateDifference(table, alpha)` | the interval on the baseline rate minus the candidate rate of paired results |
| `nonInferiority({ baseline, candidate, margin, pairs, alpha, gatingFlags })` | the parity verdict of one criterion: the upper bound below the margin, and no new gating flag |
| `benjaminiHochberg(pvalues, q)` | false discovery rate control, with adjusted p-values |
| `mde({ n, repeats, baselineRate, power, alpha, rho })` | the minimum detectable effect, with the effective sample size of the repeats |
| `cusum(series, options)`, `pageHinkley(series, options)` | change detection over time |
| `ksTest(a, b, { method })` | a shift between two distributions |
| `cohenKappa(a, b, { weights, categories })`, `krippendorffAlpha(matrix, { level })` | judge agreement |
| `varianceComponents(observations, { levels, residual })`, `icc(result)` | how much of the variance sits at each level (cell, conversation, wording, repeat), and the correlation of two observations that share a level |
| `neymanAllocation({ sizes, sds, total })`, `repeatsForFloor(...)` | how to spread runs across strata, and how many repeats a precision floor needs |
| `goodTuring(counts)`, `chaoCoverage(counts)`, `hillNumbers(counts)` | how complete a sample of cells is: the estimators behind `driftbench space complete` (see [CLI](../reference/cli.md#driftbench-space-complete)) |
