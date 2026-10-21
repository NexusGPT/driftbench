# Statistics capabilities to build

The statistics package ([statistics](../concepts/statistics.md)) covers what the campaign verdict, the gate and the reports need today. Driftbench itself computes a few more statistics inline: the means and the median of its checks and reports, the total variation distance of `intake fidelity`, balanced accuracy and Gwet's AC1 in the judge calibration report, the F-beta score of the tool call check, and the Bonferroni level of the feed. Each page below defines those functions, one section per function, with its formula, its result and the inputs it refuses. The statistics validator (`driftbench validate stats`) holds, for every function, a set of cases computed with exact arithmetic, and the function is done when its cases pass.

Status: built. Every function of these pages exists in `@agent-nexus/driftbench-stats`.

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
| [Descriptive and robust statistics](descriptive.md) | the median, the geometric mean and the harmonic mean |
| [Many comparisons and combined evidence](multiplicity.md) | the level of each test that keeps the family-wise error rate at a chosen level |
| [Classification and agreement](classification.md) | balanced accuracy and the F-beta score of a classifier or a judge, and Gwet's AC1 between raters |
| [Distances and drift](distance.md) | the total variation distance between two probability vectors |
