# Design, allocation and variance

This page defines three functions that plan a study: the smallest detectable difference between two means, the design effect of unequal weights, and the allocation of a sample over strata. Every function obeys the [shared conventions](capabilities.md#conventions): the `RangeError` rules, the accuracy of a relative 1e-11, and the quantiles of the normal passed in as arguments. This page repeats none of them.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

One term is used throughout. A "per arm" size is the number of units in each of two equal groups.

## Power

The functions of this section live in `packages/stats/src/design-power.ts`.

### `minimumDetectableMeanDifference`

```ts
minimumDetectableMeanDifference(sd: number, nPerArm: number, zAlpha: number, zBeta: number): number
```

* **File.** `packages/stats/src/design-power.ts`.
* **Definition.** The smallest difference between two means that a test with `nPerArm` units per arm detects, at the level given by `zAlpha` and the power given by `zBeta`. The value is `(zAlpha + zBeta) * sd * sqrt(2 / nPerArm)`. At this difference `delta`, `2 * ((zAlpha + zBeta) * sd / delta)^2` equals `nPerArm`.
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
