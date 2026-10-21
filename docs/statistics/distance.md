# Distances and drift

This page defines sixteen functions that measure how far two distributions or two runs are apart, whether a series of scores trends, and whether a process stays in control. It follows the conventions of [Statistics capabilities to build](capabilities.md): the accuracy, the `RangeError` rules, and the way an array of numbers is checked before any computation.

Status: partly built. `totalVariationDistance` exists in `@agent-nexus/driftbench-stats`; the other functions are planned.

Every function is pure: the same inputs give the same output, and the inputs are never modified. Numbers are compared as binary64 values, so two values are equal only when they are the same double.

## Divergences between probability vectors

The functions of this part are in `packages/stats/src/divergence.ts`.

A probability vector is an array of at least one number, each in [0, 1], whose sum differs from 1 by at most 1e-9. The vector is used as given: no function divides it by its sum. Each function here takes two probability vectors of the same length (the bins of one histogram, in the same order) and throws a `RangeError` when:

* an array is empty, holds a `NaN` or an infinity, or holds a number outside [0, 1];
* the two arrays differ in length;
* the sum of an array differs from 1 by more than 1e-9.

All logarithms are natural logarithms. A term `0 * ln(0 / x)` is 0.

### `klDivergence`
```ts
klDivergence(p: number[], q: number[]): number
```
* **Definition.** The Kullback-Leibler divergence of `p` from `q`: the sum over the positions `i` with `p[i] > 0` of `p[i] * ln(p[i] / q[i])`. A position with `p[i] = 0` adds 0, whatever `q[i]` is, including 0. The divergence is not symmetric: `klDivergence(p, q)` and `klDivergence(q, p)` differ in general. It is 0 when `p` and `q` hold the same values. Each term is formed as `p[i] * ln(p[i] / q[i])`, so identical vectors give exactly 0.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` for an invalid probability vector (see above), and when some position has `p[i] > 0` and `q[i] = 0`, where the divergence is infinite.
* **Example.** `klDivergence([0.5, 0.5], [0.25, 0.75])` is 0.14384103622589045. `klDivergence([1, 0], [0.5, 0.5])` is 0.6931471805599453. `klDivergence([0.5, 0.5], [1, 0])` throws.
* **File.** `packages/stats/src/divergence.ts`.

### `jensenShannonDivergence`
```ts
jensenShannonDivergence(p: number[], q: number[]): number
```
* **Definition.** With the midpoint `m[i] = (p[i] + q[i]) / 2`, the value is `0.5 * KL(p, m) + 0.5 * KL(q, m)`, where `KL` is the sum of `x[i] * ln(x[i] / m[i])` over the positions with `x[i] > 0`. The logarithm has base e, so the value lies between 0 and `ln 2` (0.6931471805599453). It is symmetric in `p` and `q`, and it is finite for every pair of valid vectors, also when one vector has a zero where the other does not.
* **Returns.** A number between 0 and `ln 2`.
* **Throws.** A `RangeError` for an invalid probability vector (see above).
* **Example.** `jensenShannonDivergence([1, 0], [0, 1])` is 0.6931471805599453. `jensenShannonDivergence([0.4, 0.6], [0.1, 0.9])` is 0.06328782441845603. `jensenShannonDivergence([0.5, 0.5], [0.5, 0.5])` is 0.
* **File.** `packages/stats/src/divergence.ts`.

### `hellingerDistance`
```ts
hellingerDistance(p: number[], q: number[]): number
```
* **Definition.** `sqrt(0.5 * sum((sqrt(p[i]) - sqrt(q[i]))^2))` over all positions. The value is 0 for equal vectors and 1 for vectors whose supports do not overlap. Each squared difference is formed from the two square roots, not from `1 - sum(sqrt(p[i] * q[i]))`, which loses accuracy when the vectors are close.
* **Returns.** A number between 0 and 1.
* **Throws.** A `RangeError` for an invalid probability vector (see above).
* **Example.** `hellingerDistance([0.5, 0.5], [0.25, 0.75])` is 0.18459191128251454. `hellingerDistance([1, 0], [0, 1])` is 1. `hellingerDistance([0.5, 0.5, 0], [0, 0.5, 0.5])` is 0.7071067811865476.
* **File.** `packages/stats/src/divergence.ts`.

### `totalVariationDistance`
```ts
totalVariationDistance(p: number[], q: number[]): number
```
* **Definition.** `0.5 * sum(|p[i] - q[i]|)` over all positions: the largest difference in probability that the two vectors give to one event.
* **Returns.** A number between 0 and 1.
* **Throws.** A `RangeError` for an invalid probability vector (see above).
* **Example.** `totalVariationDistance([0.5, 0.5], [0.25, 0.75])` is 0.25. `totalVariationDistance([0.3, 0.7, 0], [0.3, 0.3, 0.4])` is 0.4. `totalVariationDistance([1, 0], [0, 1])` is 1.
* **File.** `packages/stats/src/divergence.ts`.

### `populationStabilityIndex`
```ts
populationStabilityIndex(expected: number[], actual: number[]): number
```
* **Definition.** `sum((actual[i] - expected[i]) * ln(actual[i] / expected[i]))` over all positions. It equals `klDivergence(actual, expected) + klDivergence(expected, actual)`, and it is symmetric in its two arguments. Each term is at least 0, so the sum has no cancellation. The function returns the number and applies no threshold.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` for an invalid probability vector (see above), and when any entry of either vector is 0. Both vectors must be strictly positive, because an empty bin makes the index infinite.
* **Example.** `populationStabilityIndex([0.5, 0.5], [0.9, 0.1])` is 0.8788898309344877. `populationStabilityIndex([0.7, 0.3], [0.4, 0.6])` is 0.3758288905486103. `populationStabilityIndex([0.5, 0.25, 0.25], [0.5, 0.25, 0.25])` is 0. `populationStabilityIndex([0.5, 0.5, 0], [0.4, 0.3, 0.3])` throws.
* **File.** `packages/stats/src/divergence.ts`.

## Distances between samples

The functions of this part are in `packages/stats/src/distance.ts`. They compare two samples of real numbers on one axis. Each sample is an array of finite numbers in any order; the function sorts a copy.

### `wassersteinDistance1D`
```ts
wassersteinDistance1D(a: number[], b: number[]): number
```
* **Definition.** The first Wasserstein distance between the two empirical distributions. Sort both samples; the value is the mean of `|a_sorted[i] - b_sorted[i]|` over `i`. It equals the area between the two empirical distribution functions, and it is in the unit of the data.
* **Returns.** A number, at least 0. It is 0 when the two samples hold the same values in any order.
* **Throws.** A `RangeError` when the samples are empty or differ in length.
* **Example.** `wassersteinDistance1D([0, 1], [2, 3])` is 2. `wassersteinDistance1D([3, 1, 2], [10, 12, 11])` is 9. `wassersteinDistance1D([-2, 0, 2], [-1, 1, 5])` is 1.6666666666666667.
* **File.** `packages/stats/src/distance.ts`.

### `energyDistance1D`
```ts
energyDistance1D(a: number[], b: number[]): number
```
* **Definition.** `2 * E|X - Y| - E|X - X'| - E|Y - Y'|`, where `X` and `X'` are drawn independently from `a`, `Y` and `Y'` independently from `b`, each draw uniform over the positions. The three means are over all pairs, so `E|X - Y|` has `a.length * b.length` pairs, `E|X - X'|` has `a.length^2` ordered pairs and `E|Y - Y'|` has `b.length^2`, and the pairs of a position with itself count and contribute 0 (the V statistic). The two samples may have different lengths. On the real line the value equals twice the integral of the squared difference of the two empirical distribution functions, `2 * integral((Fa(x) - Fb(x))^2 dx)`. Compute it that way, from the merged sorted values: the three means subtract nearly equal numbers when the samples are close, and the integral form does not.
* **Returns.** A number, at least 0. It is exactly 0 when the two samples have the same empirical distribution, for example `[1, 2]` and `[1, 1, 2, 2]`.
* **Throws.** A `RangeError` when a sample is empty.
* **Example.** `energyDistance1D([0], [1])` is 2. `energyDistance1D([0, 1], [2, 3])` is 3. `energyDistance1D([1, 2, 3, 4], [2.5])` is 0.75. `energyDistance1D([1, 1, 5], [1, 5, 5])` is 0.8888888888888888.
* **File.** `packages/stats/src/distance.ts`.

## Trend and change

The functions of this part are in `packages/stats/src/trend.ts`. Each takes a series in time order at unit spacing and needs at least 2 values (fewer is a `RangeError`). Two values are tied when they are the same double.

### `mannKendallS`
```ts
mannKendallS(xs: number[]): number
```
* **Definition.** `sum(sign(xs[j] - xs[i]))` over all pairs `i < j`, with `sign(0) = 0`. A tied pair adds 0. The value is the number of rising pairs minus the number of falling pairs.
* **Returns.** An integer-valued number between `-n(n-1)/2` and `n(n-1)/2`.
* **Throws.** Nothing beyond the shared conventions and the minimum of 2 values.
* **Example.** `mannKendallS([1, 2, 3, 4, 5])` is 10. `mannKendallS([5, 4, 3, 2, 1])` is -10. `mannKendallS([2, 1, 3, 3, 5, 4])` is 10. `mannKendallS([1, 1, 1])` is 0.
* **File.** `packages/stats/src/trend.ts`.

### `mannKendallVariance`
```ts
mannKendallVariance(xs: number[]): number
```
* **Definition.** The variance of `S` under the hypothesis of no trend, with the correction for ties: `(n(n-1)(2n+5) - sum(t(t-1)(2t+5))) / 18`, where `n` is the count and the sum runs over each group of equal values, `t` being the size of the group. A value that occurs once is a group of size 1 and adds 0. It is the exact variance of `S` over all orderings of the values.
* **Returns.** A number, at least 0. It is 0 when all values are equal.
* **Throws.** Nothing beyond the shared conventions and the minimum of 2 values.
* **Example.** `mannKendallVariance([1, 2, 3, 4])` is 8.666666666666666. `mannKendallVariance([1, 1, 2, 2, 3])` is 14.666666666666666. `mannKendallVariance([5, 5, 5, 5])` is 0.
* **File.** `packages/stats/src/trend.ts`.

### `theilSenSlope`
```ts
theilSenSlope(xs: number[]): number
```
* **Definition.** The median of the slopes `(xs[j] - xs[i]) / (j - i)` over all pairs `i < j`. The positions are 0, 1, 2, ... so the unit of the slope is the unit of the data per step. There are `n(n-1)/2` slopes. With an odd count of slopes the median is the middle one in sorted order; with an even count it is the mean of the two middle ones. Tied values give slopes of 0 and are kept.
* **Returns.** A number, negative for a falling series and 0 for a flat one.
* **Throws.** Nothing beyond the shared conventions and the minimum of 2 values.
* **Example.** `theilSenSlope([1, 2, 3, 4, 100])` is 1, where the last value does not move the median. `theilSenSlope([1, 3, 2, 5, 4])` is 0.875. `theilSenSlope([2, 2, 2])` is 0.
* **File.** `packages/stats/src/trend.ts`.

### `autocorrelationLag`
```ts
autocorrelationLag(xs: number[], lag: number): number
```
* **Definition.** With `mean` the arithmetic mean of `xs` and `n` its length, the sample autocorrelation at `lag` is `sum((xs[t] - mean) * (xs[t + lag] - mean))` for `t` from 0 to `n - lag - 1`, divided by `sum((xs[t] - mean)^2)` for `t` from 0 to `n - 1`. Both sums use the deviations from the mean of the whole series. The numerator has `n - lag` terms and the denominator `n`; no further factor is applied. Compute the deviations first, then the sums.
* **Returns.** A number between -1 and 1.
* **Throws.** A `RangeError` when `lag` is not an integer from 1 to `n - 1`, and when every value of `xs` equals the first value (compare the values, not the computed deviations), because the denominator is 0.
* **Example.** `autocorrelationLag([1, 2, 3, 4, 5], 1)` is 0.4. `autocorrelationLag([1, 2, 3, 4, 5], 2)` is -0.1. `autocorrelationLag([1, 2, 3, 4, 5], 4)` is -0.4. `autocorrelationLag([1, -1, 1, -1], 1)` is -0.75. `autocorrelationLag([2, 2, 2, 2], 1)` throws.
* **File.** `packages/stats/src/trend.ts`.

### `durbinWatson`
```ts
durbinWatson(residuals: number[]): number
```
* **Definition.** `sum((e[t] - e[t-1])^2)` for `t` from 1 to `n - 1`, divided by `sum(e[t]^2)` for `t` from 0 to `n - 1`, where `e` is `residuals`. The residuals are used as given and are not centred. A value near 2 means no first order autocorrelation, a value near 0 a positive one and a value near 4 a negative one.
* **Returns.** A number between 0 and 4.
* **Throws.** A `RangeError` when every residual is 0, because the denominator is 0.
* **Example.** `durbinWatson([1, -1, 1, -1])` is 3. `durbinWatson([1, 2, 3, 4, 5])` is 0.07272727272727272. `durbinWatson([1, -1])` is 2. `durbinWatson([2, 2, 2])` is 0.
* **File.** `packages/stats/src/trend.ts`.

### `changePointBestSplit`
```ts
changePointBestSplit(xs: number[]): { index: number; sse: number }
```
* **Definition.** For each `index` from 1 to `n - 1`, split the series into the left segment `xs.slice(0, index)` and the right segment `xs.slice(index)`. The cost of a split is the sum of squared deviations of the left segment from its own mean plus the same for the right segment. The result is the split of least cost. Compute each segment sum of squares from the deviations from the segment mean, not from `sum(x^2) - n * mean^2`. A later split replaces the best one so far only when its cost is smaller by more than `1e-9` times the total sum of squares of `xs` about its overall mean; otherwise the splits tie and the smallest index stays. For a series of equal values the total is 0 and the result is `index` 1.
* **Returns.** An object `{ index, sse }`. `index` is the position of the first value of the right segment, an integer from 1 to `n - 1`. `sse` is the cost of that split.
* **Throws.** Nothing beyond the shared conventions and the minimum of 2 values.
* **Example.** `changePointBestSplit([1, 1, 1, 5, 5, 5])` is `{ index: 3, sse: 0 }`. `changePointBestSplit([3, 7])` is `{ index: 1, sse: 0 }`. `changePointBestSplit([0, 1, 0, 1])` is `{ index: 1, sse: 0.6666666666666666 }`, because the splits at 1 and 3 tie. `changePointBestSplit([9, 8, 9, 1, 2, 1, 2])` is `{ index: 3, sse: 1.6666666666666667 }`.
* **File.** `packages/stats/src/trend.ts`.

## Control charts

The functions of this part are in `packages/stats/src/control.ts`.

### `ewmaSeries`
```ts
ewmaSeries(xs: number[], lambda: number): number[]
```
* **Definition.** The exponentially weighted moving average with smoothing weight `lambda`. Start from `z_0 = xs[0]`. For `t` = 1, 2, ..., n, with `x_t = xs[t - 1]`, `z_t = lambda * x_t + (1 - lambda) * z_{t-1}`. The result lists `z_1, ..., z_n`. Because `z_0 = x_1`, the first element is `xs[0]`. With `lambda = 1` the result equals `xs`.
* **Returns.** An array of numbers with the same length as `xs`. The input is not modified.
* **Throws.** A `RangeError` when `lambda` is not in the half open interval (0, 1], meaning 0 or less, or more than 1.
* **Example.** `ewmaSeries([1, 2, 3], 0.5)` is `[1, 1.5, 2.25]`. `ewmaSeries([10, 20, 30, 40], 0.75)` is `[10, 17.5, 26.875, 36.71875]`. `ewmaSeries([5], 0.2)` is `[5]`.
* **File.** `packages/stats/src/control.ts`.

### `ewmaControlLimits`
```ts
ewmaControlLimits(mean: number, sigma: number, lambda: number, L: number, t: number): { lower: number; upper: number }
```
* **Definition.** The limits of the EWMA chart at step `t` = 1, 2, ...: `mean - L * sigma * w` and `mean + L * sigma * w`, with `w = sqrt(lambda / (2 - lambda) * (1 - (1 - lambda)^(2 * t)))`. As `t` grows the limits approach the steady state half width `L * sigma * sqrt(lambda / (2 - lambda))`. Compute `1 - (1 - lambda)^(2 * t)` as `-expm1(2 * t * log1p(-lambda))` when `lambda` is small, so that the difference does not lose digits; for `lambda = 1` the term is 1.
* **Returns.** An object `{ lower, upper }`, with `lower` below `upper`.
* **Throws.** A `RangeError` when `sigma` is not positive, when `L` is not positive, when `lambda` is not in (0, 1], when `t` is not an integer of at least 1, or when `mean` is not finite.
* **Example.** `ewmaControlLimits(0, 1, 0.2, 3, 10)` is `{ lower: -0.9942186806502539, upper: 0.9942186806502539 }`. `ewmaControlLimits(10, 2, 1, 3, 3)` is `{ lower: 4, upper: 16 }`. `ewmaControlLimits(0, 1, 0.2, 3, 1000)` is `{ lower: -1, upper: 1 }`.
* **File.** `packages/stats/src/control.ts`.

### `shewhartXbarLimits`
```ts
shewhartXbarLimits(mean: number, sigma: number, n: number, L: number): { lower: number; center: number; upper: number }
```
* **Definition.** The limits of the chart of subgroup means for subgroups of `n` values drawn from a process with mean `mean` and standard deviation `sigma`: `center = mean`, `lower = mean - L * sigma / sqrt(n)` and `upper = mean + L * sigma / sqrt(n)`. `L` is the width in standard errors, usually 3.
* **Returns.** An object `{ lower, center, upper }`.
* **Throws.** A `RangeError` when `sigma` is not positive, when `L` is not positive, when `n` is not an integer of at least 1, or when `mean` is not finite.
* **Example.** `shewhartXbarLimits(50, 2, 4, 3)` is `{ lower: 47, center: 50, upper: 53 }`. `shewhartXbarLimits(10, 1, 1, 3)` is `{ lower: 7, center: 10, upper: 13 }`. `shewhartXbarLimits(100, 12, 5, 3)` is `{ lower: 83.90031056200151, center: 100, upper: 116.09968943799849 }`.
* **File.** `packages/stats/src/control.ts`.
