# Design, allocation and variance

This page defines eight functions that plan a study and estimate variance: sample sizes, the smallest detectable difference of two means, the design effect of weights, the allocation of a sample over strata, and the jackknife variance of a mean. Every function obeys the [shared conventions](capabilities.md#conventions): the `RangeError` rules, the accuracy of a relative 1e-11, and the quantiles of the normal passed in as arguments. This page repeats none of them.

Status: partly built. `sampleSizeTwoMeans`, `sampleSizeTwoProportions`, `sampleSizeProportionMargin`, `sampleSizeMeanMargin`, `minimumDetectableMeanDifference`, `kishDesignEffect`, `proportionalAllocation` and `jackknifeMeanVariance` exist in `@agent-nexus/driftbench-stats`; the other functions are planned.

One term is used throughout: a "per arm" size is the number of units in each of two equal groups.

## Sample sizes

The functions of this section live in `packages/stats/src/sample-size.ts`.

The four functions that return a sample size give a whole number: the smallest integer that is not below the exact value of the formula. A computation in doubles may land a few units in the last place away from an integer that the exact value hits. The function therefore rounds the computed value to 9 decimals and takes the ceiling of the rounded value. A result is never below 1, because every formula gives a positive value: a value that rounds to 0 is returned as 1. A value of 1e15 or more is returned as its ceiling without the rounding step, since 9 decimals are finer than one unit in the last place there.

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

## Power

The functions of this section live in `packages/stats/src/design-power.ts`.

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

## Variance estimates

The functions of this section live in `packages/stats/src/variance-estimates.ts`. They use the sample variance, which divides by the number of values minus 1. They compute deviations from the mean of the values and do not use the difference of a sum of squares and a squared sum.

### `jackknifeMeanVariance`

```ts
jackknifeMeanVariance(xs: number[]): number
```

* **File.** `packages/stats/src/variance-estimates.ts`.
* **Definition.** The jackknife estimate of the variance of the sample mean. Let `n` be the number of values, `mean_i` the mean of the values with the value at index `i` left out, and `mean_dot` the mean of the `n` leave-one-out means. The result is `(n - 1) / n * sum over i of (mean_i - mean_dot)^2`. For the mean it equals the sample variance of `xs` divided by `n`. The function computes the leave-one-out means; it does not need the shortcut.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` when `xs` has fewer than 2 values.
* **Example.** `jackknifeMeanVariance([1, 3])` is 1. `jackknifeMeanVariance([2, 4, 4, 4, 5, 5, 7, 9])` is 0.5714285714285714. `jackknifeMeanVariance([4, 4, 4])` is 0.
