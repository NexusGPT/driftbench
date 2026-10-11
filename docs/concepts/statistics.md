# Statistics

One run proves nothing. driftbench repeats runs, reports every rate with an interval, and compares two versions of an agent with paired tests. Everything on this page is planned, phase 4. Each function ships with reference values computed once in Python and committed as test fixtures.

## Repeats

A campaign runs each spec several times in each mode. With c passing runs out of n:

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

`campaign plan` prints the number of runs, the projected cost and the minimum detectable effect for the chosen repeats. If the effect is too large to be useful, the repeats go up before any money is spent.

## Over time

To watch a live agent: CUSUM and Page-Hinkley on pass rate, cost and latency, and a Kolmogorov-Smirnov test for a shift in a distribution.

## Judges

Cohen's kappa and Krippendorff's alpha measure how far judges agree with hand labels and with each other. See [judges](judges.md).

## Tasks

Task specs use the same statistics. One task is one cluster. An artifact check is a pass or a fail per repeat, so pass^k reads the same way for a workbook as for a reply.

## Functions

| Function | Computes |
|---|---|
| `wilson(k, n, z)` | the Wilson interval for k successes in n |
| `bootstrapCI(values, { clusters, iterations, method })` | a percentile bootstrap interval, by cluster |
| `passK(c, n, k)` | pass^k |
| `passAtK(c, n, k)` | pass@k |
| `unreliability(samples)` | the 90th percentile minus the 10th |
| `mcnemar(b, c)` | McNemar's test on the discordant counts |
| `wilcoxonSignedRank(x, y)` | the paired signed-rank test |
| `benjaminiHochberg(pvalues, q)` | false discovery rate control |
| `mde({ n, repeats, baselineRate, power, alpha })` | the minimum detectable effect |
| `nonInferiority({ baseline, candidate, margin, pairs })` | the parity verdict |
| `cusum(series)`, `pageHinkley(series)` | change detection over time |
| `ksTest(a, b)` | a shift between two distributions |
| `cohenKappa(a, b)`, `krippendorffAlpha(matrix)` | judge agreement |
