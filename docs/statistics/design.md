# Design, allocation and variance

This page defines sixteen functions that plan a study and estimate variance: sample sizes, power, the allocation of a sample over strata, and variance estimates for two samples, a mean and a panel of raters. Every function obeys the [shared conventions](capabilities.md#conventions): the `RangeError` rules, the accuracy of a relative 1e-11, and the quantiles of the normal passed in as arguments. This page repeats none of them.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

Two terms are used throughout. `Phi` is the cumulative distribution function of the standard normal. A "per arm" size is the number of units in each of two equal groups.

## Sample sizes

The functions of this section live in `packages/stats/src/sample-size.ts`.

The four functions that return a sample size give a whole number: the smallest integer that is not below the exact value of the formula. A computation in doubles may land a few units in the last place away from an integer that the exact value hits. The function therefore rounds the computed value to 9 decimals and takes the ceiling of the rounded value. A result is never below 1, because every formula gives a positive value.

### `sampleSizeTwoMeans`

```ts
sampleSizeTwoMeans(sd: number, delta: number, zAlpha: number, zBeta: number): number
```

* **File.** `packages/stats/src/sample-size.ts`.
* **Definition.** The size per arm needed to detect a difference `delta` between two means with a common standard deviation `sd`. The exact value is `2 * ((zAlpha + zBeta) * sd / delta)^2`. The result is its ceiling, with the rounding to 9 decimals described above. `zAlpha` is the normal quantile for the significance level (for a two-sided test at 5 percent, 1.959963984540054) and `zBeta` the normal quantile for the power (0.8416212335729142 for 80 percent). The sign of `delta` does not matter.
* **Returns.** A number that is a whole number, at least 1.
* **Throws.** A `RangeError` when `sd` is not positive, when `delta` is 0, when `zAlpha` is not positive, or when `zBeta` is negative.
* **Example.** `sampleSizeTwoMeans(1, 0.5, 1.959963984540054, 0.8416212335729142)` is 63 (the exact value is about 62.79). `sampleSizeTwoMeans(2, 1, 1, 1)` is 32. `sampleSizeTwoMeans(15, -5, 1.96, 1.2815515655446004)` is 190.

### `sampleSizeTwoProportions`

```ts
sampleSizeTwoProportions(p1: number, p2: number, zAlpha: number, zBeta: number): number
```

* **File.** `packages/stats/src/sample-size.ts`.
* **Definition.** The size per arm needed to tell two proportions `p1` and `p2` apart. With `pbar = (p1 + p2) / 2` and `qbar = 1 - pbar`, the exact value is `(zAlpha * sqrt(2 * pbar * qbar) + zBeta * sqrt(p1 * (1 - p1) + p2 * (1 - p2)))^2 / (p1 - p2)^2`. The first term uses the pooled proportion, the second the two separate ones. The result is the ceiling of that value, with the rounding to 9 decimals described above. The order of `p1` and `p2` does not matter. A proportion of 0 or 1 is allowed.
* **Returns.** A number that is a whole number, at least 1.
* **Throws.** A `RangeError` when `p1` equals `p2`, when `zAlpha` is not positive, or when `zBeta` is negative.
* **Example.** `sampleSizeTwoProportions(0.5, 0.6, 1.959963984540054, 0.8416212335729142)` is 388. `sampleSizeTwoProportions(0.02, 0.01, 1.959963984540054, 0.8416212335729142)` is 2319. `sampleSizeTwoProportions(0, 0.3, 1.959963984540054, 0.8416212335729142)` is 22.

### `sampleSizeProportionMargin`

```ts
sampleSizeProportionMargin(p: number, margin: number, z: number): number
```

* **File.** `packages/stats/src/sample-size.ts`.
* **Definition.** The size needed so that the half width of a normal interval for a proportion is at most `margin`. The exact value is `z^2 * p * (1 - p) / margin^2`, where `p` is the proportion planned for. The result is the ceiling of that value, with the rounding to 9 decimals described above.
* **Returns.** A number that is a whole number, at least 1.
* **Throws.** A `RangeError` when `p` is not strictly between 0 and 1, when `margin` is not positive, or when `z` is not positive.
* **Example.** `sampleSizeProportionMargin(0.5, 0.05, 1.96)` is 385 (the exact value is 384.16). `sampleSizeProportionMargin(0.3, 0.04, 1.959963984540054)` is 505. `sampleSizeProportionMargin(0.5, 0.5, 1.96)` is 4.

### `sampleSizeMeanMargin`

```ts
sampleSizeMeanMargin(sd: number, margin: number, z: number): number
```

* **File.** `packages/stats/src/sample-size.ts`.
* **Definition.** The size needed so that the half width of a normal interval for a mean is at most `margin`. The exact value is `(z * sd / margin)^2`. The result is the ceiling of that value, with the rounding to 9 decimals described above.
* **Returns.** A number that is a whole number, at least 1.
* **Throws.** A `RangeError` when `sd` is not positive, when `margin` is not positive, or when `z` is not positive.
* **Example.** `sampleSizeMeanMargin(15, 2, 1.96)` is 217. `sampleSizeMeanMargin(1, 0.1, 1.959963984540054)` is 385. `sampleSizeMeanMargin(4, 1, 1)` is 16.

### `finitePopulationCorrection`

```ts
finitePopulationCorrection(sampleSize: number, population: number): number
```

* **File.** `packages/stats/src/sample-size.ts`.
* **Definition.** The size needed in a finite population, given the size `sampleSize` needed in an infinite one. The value is `sampleSize / (1 + (sampleSize - 1) / population)`. It is a real number and is not rounded. `sampleSize` may be a fraction and may exceed `population`; the result is then still below `population`.
* **Returns.** A number.
* **Throws.** A `RangeError` when `sampleSize` is not positive, or when `population` is 0 (it must be a positive whole number).
* **Example.** `finitePopulationCorrection(100, 1000)` is 90.99181073703366. `finitePopulationCorrection(50, 50)` is 25.252525252525253. `finitePopulationCorrection(30, 1)` is 1.

### `clusterSampleSize`

```ts
clusterSampleSize(n0: number, clusterSize: number, rho: number): number
```

* **File.** `packages/stats/src/sample-size.ts`.
* **Definition.** The size needed in a clustered sample, given the size `n0` needed with independent units. The value is `n0 * (1 + (clusterSize - 1) * rho)`, where `rho` is the intra-cluster correlation. It is a real number and is not rounded. `clusterSize` is the average number of units per cluster and may be a fraction.
* **Returns.** A number.
* **Throws.** A `RangeError` when `n0` is not positive, when `clusterSize` is below 1, or when `rho` is outside [0, 1].
* **Example.** `clusterSampleSize(100, 10, 0.05)` is 145. `clusterSampleSize(385, 25, 0.02)` is 569.8. `clusterSampleSize(50, 4, 1)` is 200.

## Power

The functions of this section live in `packages/stats/src/design-power.ts`.

### `powerOneSampleZ`

```ts
powerOneSampleZ(delta: number, sd: number, n: number, zAlpha: number): number
```

* **File.** `packages/stats/src/design-power.ts`.
* **Definition.** The power of a two-sided z test of a mean when the true shift from the null value is `delta`. With `se = sd / sqrt(n)`, the power is `Phi(delta / se - zAlpha) + Phi(-delta / se - zAlpha)`. `zAlpha` is the normal quantile for the two-sided level (1.959963984540054 for 5 percent). Both tails count. The sign of `delta` does not matter. When `delta` is 0 the power is the level of the test.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when `sd` is not positive, when `n` is 0 (it must be a positive whole number), or when `zAlpha` is not positive.
* **Example.** `powerOneSampleZ(0.5, 1, 32, 1.959963984540054)` is 0.8074304194325571. `powerOneSampleZ(-0.5, 1, 32, 1.959963984540054)` is the same value. `powerOneSampleZ(0, 1, 50, 1.959963984540054)` is 0.05 (to 15 digits).

### `powerTwoSampleZ`

```ts
powerTwoSampleZ(delta: number, sd: number, nPerArm: number, zAlpha: number): number
```

* **File.** `packages/stats/src/design-power.ts`.
* **Definition.** The power of a two-sided z test of the difference between two means, with `nPerArm` units in each arm and a common standard deviation `sd`. With `se = sd * sqrt(2 / nPerArm)`, the power is `Phi(delta / se - zAlpha) + Phi(-delta / se - zAlpha)`. The sign of `delta` does not matter. When `delta` is 0 the power is the level of the test.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when `sd` is not positive, when `nPerArm` is 0 (it must be a positive whole number), or when `zAlpha` is not positive.
* **Example.** `powerTwoSampleZ(0.5, 1, 64, 1.959963984540054)` is 0.8074304194325571. `powerTwoSampleZ(5, 15, 100, 1.96)` is 0.6543325113771309. `powerTwoSampleZ(1, 1, 1, 1.959963984540054)` is 0.10895461755061552.

### `minimumDetectableMeanDifference`

```ts
minimumDetectableMeanDifference(sd: number, nPerArm: number, zAlpha: number, zBeta: number): number
```

* **File.** `packages/stats/src/design-power.ts`.
* **Definition.** The smallest difference between two means that a test with `nPerArm` units per arm detects, at the level given by `zAlpha` and the power given by `zBeta`. The value is `(zAlpha + zBeta) * sd * sqrt(2 / nPerArm)`. It inverts the formula of `sampleSizeTwoMeans` before the ceiling: at this difference, `2 * ((zAlpha + zBeta) * sd / delta)^2` equals `nPerArm`.
* **Returns.** A positive number.
* **Throws.** A `RangeError` when `sd` is not positive, when `nPerArm` is 0 (it must be a positive whole number), when `zAlpha` is not positive, or when `zBeta` is negative.
* **Example.** `minimumDetectableMeanDifference(1, 64, 1.959963984540054, 0.8416212335729142)` is 0.49525497644991817. `minimumDetectableMeanDifference(2, 1, 1, 1)` is 5.656854249492381. `minimumDetectableMeanDifference(1, 32, 1.959963984540054, 0)` is 0.4899909961350135.

## Allocation

The functions of this section live in `packages/stats/src/allocation.ts`.

### `kishDesignEffect`

```ts
kishDesignEffect(weights: number[]): number
```

* **File.** `packages/stats/src/allocation.ts`.
* **Definition.** The design effect of unequal weights, as Kish defines it: `n * sum(w^2) / sum(w)^2`, where `n` is the number of weights and the sums run over all of them. It equals 1 plus the squared coefficient of variation of the weights (the population variance of the weights over the square of their mean). One weight gives 1. All weights equal give 1. Only the ratios between weights matter.
* **Returns.** A number, at least 1.
* **Throws.** A `RangeError` for an empty array, or when a weight is not positive (a weight of 0 throws).
* **Example.** `kishDesignEffect([1, 2, 3, 4])` is 1.2. `kishDesignEffect([0.5, 1, 1, 2.5])` is 1.36. `kishDesignEffect([1, 1, 1, 1, 10])` is 2.6530612244897958.

### `proportionalAllocation`

```ts
proportionalAllocation(strataSizes: number[], n: number): number[]
```

* **File.** `packages/stats/src/allocation.ts`.
* **Definition.** The allocation of a sample of `n` units over strata in proportion to their sizes, in whole numbers, by the largest remainder method. Let `N` be the sum of `strataSizes`. The quota of stratum `h` is `n * strataSizes[h] / N`. Each stratum first receives the floor of its quota. The units that remain (`n` minus the sum of the floors) go one each to the strata with the largest remainders, where the remainder is the quota minus its floor. When two strata have equal remainders, the stratum with the lower index comes first. Remainders are compared exactly: the quotas are rational numbers, and two remainders are equal when those rational numbers are equal. A stratum of size 0 receives 0.
* **Returns.** An array of whole numbers, one per stratum, in the order of `strataSizes`, whose sum is `n`.
* **Throws.** A `RangeError` when the sum of `strataSizes` is 0 (every stratum size must be a non-negative whole number), or when `n` is larger than that sum.
* **Example.** `proportionalAllocation([10, 20, 30], 10)` is `[2, 3, 5]`. `proportionalAllocation([1, 1, 1], 2)` is `[1, 1, 0]`, because the three remainders tie and the lower indexes win. `proportionalAllocation([1200, 800, 350, 150], 100)` is `[48, 32, 14, 6]`. `proportionalAllocation([2, 2], 3)` is `[2, 1]`.

### `costOptimalAllocation`

```ts
costOptimalAllocation(strataSizes: number[], sds: number[], costs: number[], n: number): number[]
```

* **File.** `packages/stats/src/allocation.ts`.
* **Definition.** The allocation of a total sample of `n` units that gives the smallest variance of a stratified mean for a fixed total cost, when the cost per unit in stratum `h` is `costs[h]`. The share of stratum `h` is proportional to `strataSizes[h] * sds[h] / sqrt(costs[h])`. The allocation is `n` times that weight divided by the sum of the weights. It is a real number per stratum and is not rounded. It is not capped by the stratum size. When `n` is 0 every entry is 0.
* **Returns.** An array of numbers, one per stratum, in the order of the inputs, whose sum is `n`.
* **Throws.** A `RangeError` when a stratum size is 0 (every size must be a positive whole number), when an entry of `sds` or `costs` is not positive, or when the three arrays are empty or do not have the same length.
* **Example.** `costOptimalAllocation([1000, 2000, 500], [10, 15, 20], [1, 4, 9], 100)` is `[35.294117647058826, 52.94117647058823, 11.764705882352942]`. `costOptimalAllocation([100, 100], [5, 5], [2, 2], 50)` is `[25, 25]`. `costOptimalAllocation([10, 20, 30], [1, 1, 1], [1, 1, 1], 12)` is `[2, 4, 6]`.

## Variance estimates

The functions of this section live in `packages/stats/src/variance-estimates.ts`. They use the sample variance, which divides by the number of values minus 1. They compute deviations from the mean of the values and do not use the difference of a sum of squares and a squared sum.

### `welchT`

```ts
welchT(a: number[], b: number[]): { t: number; df: number }
```

* **File.** `packages/stats/src/variance-estimates.ts`.
* **Definition.** The Welch statistic for two samples with unequal variances. Let `na`, `nb` be the sizes, `ma`, `mb` the means and `va`, `vb` the sample variances. Let `sa = va / na` and `sb = vb / nb`. Then `t = (ma - mb) / sqrt(sa + sb)` and `df = (sa + sb)^2 / (sa^2 / (na - 1) + sb^2 / (nb - 1))` (the Welch and Satterthwaite degrees of freedom). The sign of `t` follows `ma - mb`. When the two means are equal, `t` is 0. When exactly one sample is constant, `df` is still defined by the formula.
* **Returns.** An object with two fields: `t`, a number, and `df`, a number that is not rounded.
* **Throws.** A `RangeError` when `a` or `b` has fewer than 2 values, or when every value of `a` is equal and every value of `b` is equal (the denominator is 0).
* **Example.** `welchT([1, 3], [2, 6])` is `{ t: -0.8944271909999159, df: 1.4705882352941178 }`. `welchT([5, 5, 5], [4, 6, 8])` is `{ t: -0.8660254037844386, df: 2 }`. `welchT([1, 2, 3], [0, 2, 4, 2])` is `{ t: 0, df: 4.909090909090909 }`.

### `pooledVariance`

```ts
pooledVariance(a: number[], b: number[]): number
```

* **File.** `packages/stats/src/variance-estimates.ts`.
* **Definition.** The pooled sample variance of two samples: `((na - 1) * va + (nb - 1) * vb) / (na + nb - 2)`, where `va` and `vb` are the sample variances of `a` and `b`. It equals the sum of the squared deviations of each value from the mean of its own sample, divided by `na + nb - 2`. When every value in both samples is constant, the result is 0.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` when `a` or `b` has fewer than 2 values.
* **Example.** `pooledVariance([1, 2], [3, 5])` is 1.25. `pooledVariance([2, 4, 4, 4, 5, 5, 7, 9], [1, 2, 3])` is 3.7777777777777777. `pooledVariance([3, 3], [7, 7])` is 0.

### `jackknifeMeanVariance`

```ts
jackknifeMeanVariance(xs: number[]): number
```

* **File.** `packages/stats/src/variance-estimates.ts`.
* **Definition.** The jackknife estimate of the variance of the sample mean. Let `n` be the number of values, `mean_i` the mean of the values with the value at index `i` left out, and `mean_dot` the mean of the `n` leave-one-out means. The result is `(n - 1) / n * sum over i of (mean_i - mean_dot)^2`. For the mean it equals the sample variance of `xs` divided by `n`. The function computes the leave-one-out means; it does not need the shortcut.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` when `xs` has fewer than 2 values.
* **Example.** `jackknifeMeanVariance([1, 3])` is 1. `jackknifeMeanVariance([2, 4, 4, 4, 5, 5, 7, 9])` is 0.5714285714285714. `jackknifeMeanVariance([4, 4, 4])` is 0.

### `iccTwoWayAgreement`

```ts
iccTwoWayAgreement(matrix: number[][]): number
```

* **File.** `packages/stats/src/variance-estimates.ts`.
* **Definition.** The intraclass correlation ICC(2,1) for the absolute agreement of single ratings, from a matrix with one row per subject and one column per rater. Let `n` be the number of rows, `k` the number of columns, `grand` the mean of all entries, `rowMean[i]` the mean of row `i` and `colMean[j]` the mean of column `j`. The mean squares of the two-way analysis of variance without replication are:
  * `MSR = k * sum over i of (rowMean[i] - grand)^2 / (n - 1)` (subjects);
  * `MSC = n * sum over j of (colMean[j] - grand)^2 / (k - 1)` (raters);
  * `MSE = sum over i, j of (x[i][j] - rowMean[i] - colMean[j] + grand)^2 / ((n - 1) * (k - 1))` (error).

  The result is `(MSR - MSE) / (MSR + (k - 1) * MSE + k * (MSC - MSE) / n)`. It is negative when the raters disagree more than the subjects differ. It is not clamped.
* **Returns.** A number. It can be negative, and for a small matrix it can be below -1.
* **Throws.** A `RangeError` when the matrix has fewer than 2 rows, when a row has fewer than 2 entries, when the rows do not all have the same length, or when the denominator is 0 in exact arithmetic. The denominator is 0 when every entry is equal, and for a matrix of 2 rows and 2 columns whose row means are equal and whose column means are equal.
* **Example.** For the six subjects and four raters `[[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]]`, `iccTwoWayAgreement` is 0.28976377952755905. `iccTwoWayAgreement([[1, 1], [2, 2], [3, 3]])` is 1, because the two raters agree on every subject. `iccTwoWayAgreement([[4, 4, 5], [4, 5, 4], [5, 4, 4]])` is -1.
