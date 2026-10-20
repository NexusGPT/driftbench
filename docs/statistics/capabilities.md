# Statistics capabilities to build

The statistics package ([statistics](../concepts/statistics.md)) covers what the campaign verdict, the gate and the reports need today. An evaluation framework needs more: robust summaries, effect sizes with their intervals, exact tests, control of many comparisons, sequential decisions, Bayesian summaries, agreement and calibration, distances between runs, and the arithmetic of sample sizes. Each page below defines functions that the package does not have yet, one section per function, with its formula, its result and the inputs it refuses. The statistics validator (`driftbench validate stats`) holds, for every function, a set of cases computed with exact arithmetic, and the function is done when its cases pass.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

## Conventions

These hold for every function of every page, unless its section says otherwise.

* **Numbers and arrays.** Arguments are JavaScript numbers (binary64) and plain arrays of numbers. A result is a number, a plain array of numbers, a string where its section says so, or a plain object with the field names its section lists.
* **Accuracy.** A result agrees with the exact value within a relative 1e-11, unless its section gives another tolerance. A function that sums many terms or takes a logarithm keeps that accuracy; it does not form a difference of nearly equal large numbers when the formula allows another way.
* **Invalid input is a `RangeError`.** A function throws a `RangeError` for each of these, whatever else its section lists: an array that is empty where the section needs at least one value (or fewer values than the minimum it states); a number that is `NaN` or infinite; a count that is not a non-negative integer (a negative, a fraction or an unsafe integer); a probability outside [0, 1] (or outside (0, 1) where the section says open); a standard deviation, a variance, a size or a weight that the section requires to be positive and is not; arrays that must have the same length and do not. The check runs before any computation, so a bad argument never gives a number.
* **Variance.** "Sample variance" divides by n - 1 and "population variance" by n. A function names which it uses.
* **Quantiles of the normal.** A function that needs a quantile of the normal distribution takes it as an argument named `z` (or `zAlpha`, `zBeta`) and does not compute it. `Z95` is 1.959963984540054.
* **Ties.** Where ranks are used, tied values share the average of the ranks they would take (mid-ranks), unless a section says otherwise.
* **Where it goes.** Each section names the file of `packages/stats/src` it belongs in. Every function is exported from `packages/stats/src/index.ts` with its result type.

## Pages

| Page | What it defines |
|---|---|
| [Descriptive and robust statistics](descriptive.md) | location, spread, shape and correlation measures |
| [Effect sizes](effectsize.md) | standardised differences, ratios and differences of rates, with closed-form intervals |
| [Exact tests](exacttests.md) | p-values by enumeration, and the statistics of classical tests |
| [Many comparisons and combined evidence](multiplicity.md) | adjustments, error rates and combination of p-values |
| [Sequential evidence](sequential.md) | sequential tests, e-values and boundaries |
| [Bayesian summaries and rate intervals](bayes.md) | beta-binomial summaries and closed-form intervals on a rate |
| [Classification, calibration and agreement](classification.md) | scores of a classifier or a judge, calibration, and agreement between raters |
| [Distances and drift](distance.md) | distances between distributions, trend and control charts |
| [Design, allocation and variance](design.md) | sample sizes, power, allocation, survey and variance estimates |
