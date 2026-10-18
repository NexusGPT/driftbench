# Many comparisons and combined evidence

A report that compares many criteria, or runs many suites, makes many tests at once. The chance that at least one of them looks significant by luck grows with their number. This page defines functions that control that chance, estimate how many nulls are true, give the error-rate formulas, and combine several p-values into one statement. The conventions of the [shared page](capabilities.md#conventions) apply to every function here.

The [statistics page](../concepts/statistics.md) defines `holm` and `benjaminiHochberg`; this page does not redefine them. The adjustments below add the Bonferroni, Sidak, Holm-Sidak, Hochberg, Hommel and Benjamini-Yekutieli forms. For the same p-values, each adjusted value obeys this order: Hommel, then Hochberg, then Holm, then Bonferroni, from smallest to largest. Holm-Sidak is never larger than Holm.

Words used in the sections:

* **p-value.** A number in [0, 1]. A section that needs it above 0 says so.
* **m.** The number of p-values in the array.
* **Sorted order.** The p-values sorted ascending. `p(1)` is the smallest and `p(m)` the largest. Equal p-values keep their input order in the sort, and the result never depends on how equal values are ordered.
* **Adjusted p-value.** The smallest significance level at which the procedure rejects that hypothesis. Every adjusted p-value is at most 1.

## Adjusting p-values

The six functions of this section live in `packages/stats/src/adjust.ts`. Each takes an array of p-values and returns an array of adjusted p-values in the input order. They never modify the input. Equal p-values get equal adjusted values. One p-value is returned unchanged, as a number in an array of length 1.

### `bonferroniAdjust`
```ts
bonferroniAdjust(pvalues: number[]): number[]
```
* **Definition.** The adjusted value of each p-value is `min(1, m p)`.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `bonferroniAdjust([0.01, 0.04])` is `[0.02, 0.08]`. `bonferroniAdjust([0.04, 0.01, 0.04, 0.04, 0.2])` is `[0.2, 0.05, 0.2, 0.2, 1]`.

### `sidakAdjust`
```ts
sidakAdjust(pvalues: number[]): number[]
```
* **Definition.** The adjusted value of each p-value is `1 - (1 - p)^m`. Compute it as `-expm1(m log1p(-p))`, so that a p-value near 0 keeps its relative accuracy. A p-value of 1 gives 1, and a p-value of 0 gives 0.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `sidakAdjust([0.01, 0.04])` is `[0.0199, 0.0784]`. `sidakAdjust([0.3, 0.3, 0.3])` is `[0.657, 0.657, 0.657]`.

### `holmSidakAdjust`
```ts
holmSidakAdjust(pvalues: number[]): number[]
```
* **Definition.** Sort the p-values ascending. For the rank `i` from 1 to m, let `c(i) = 1 - (1 - p(i))^(m - i + 1)`, computed as `-expm1((m - i + 1) log1p(-p(i)))`. The adjusted value at rank `i` is the largest of `c(1), ..., c(i)`. The values are then put back in the input order.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `holmSidakAdjust([0.01, 0.04])` is `[0.0199, 0.04]`. `holmSidakAdjust([0.04, 0.01, 0.04, 0.04, 0.2])` is `[0.15065344, 0.0490099501, 0.15065344, 0.15065344, 0.2]`.

### `hochbergAdjust`
```ts
hochbergAdjust(pvalues: number[]): number[]
```
* **Definition.** Sort the p-values ascending. For the rank `i` from 1 to m, let `r(i) = (m - i + 1) p(i)`. The adjusted value at rank `i` is `min(1, r(j))` minimised over all ranks `j` from `i` to m. The values are then put back in the input order. This is the step up form of Holm's procedure.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `hochbergAdjust([0.01, 0.04])` is `[0.02, 0.04]`. `hochbergAdjust([0.04, 0.01, 0.04, 0.04, 0.2])` is `[0.08, 0.05, 0.08, 0.08, 0.2]`.

### `hommelAdjust`
```ts
hommelAdjust(pvalues: number[]): number[]
```
* **Definition.** Hommel's procedure is closed testing with Simes' test. The adjusted value of a hypothesis is the largest Simes p-value (see `simesPValue`) over all subsets of the hypotheses that contain it. The steps below compute the same values without listing the subsets. Let `p(1) <= ... <= p(m)` be the sorted p-values and `n` the count `m`.
  1. Let `c = min over j of n p(j) / j`. Set `a(i) = c` and `q(i) = c` for every rank `i`.
  2. For `k` from `n - 1` down to 2 (no step runs when `n <= 2`), with `t = n - k + 1`:
     1. Let `u = min over j from t + 1 to n of k p(j) / (j - t + 1)`.
     2. For each rank `i` from 1 to `t`, set `q(i) = min(k p(i), u)`.
     3. For each rank `i` from `t + 1` to `n`, set `q(i) = q(t)`.
     4. For each rank `i` from 1 to `n`, set `a(i) = max(a(i), q(i))`.
  3. The adjusted value at rank `i` is `max(a(i), p(i))`.
  4. Put the values back in the input order.

  For one p-value the result is that p-value. For two p-values it equals `hochbergAdjust`.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `hommelAdjust([0.01, 0.04])` is `[0.02, 0.04]`. `hommelAdjust([0.9, 0.04, 0.5, 0.012, 0.012, 0.3])` is `[0.9, 0.16, 0.9, 0.06, 0.06, 0.75]`. For the ten p-values `[0.039, 0.001, 0.205, 0.042, 0.008, 0.212, 0.041, 0.074, 0.06, 0.216]` the result is `[0.185, 0.01, 0.216, 0.185, 0.072, 0.216, 0.185, 0.216, 0.216, 0.216]`, where `hochbergAdjust` gives 0.216 at every rank except the two smallest.

### `benjaminiYekutieliAdjust`
```ts
benjaminiYekutieliAdjust(pvalues: number[]): number[]
```
* **Definition.** Let `H = 1 + 1/2 + ... + 1/m`. Sort the p-values ascending. For the rank `i` from 1 to m, let `r(i) = m H p(i) / i`. The adjusted value at rank `i` is `min(1, r(j))` minimised over all ranks `j` from `i` to m. The values are then put back in the input order. This controls the false discovery rate under any dependence between the tests. It is `H` times the Benjamini-Hochberg adjustment, capped at 1.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `benjaminiYekutieliAdjust([0.01, 0.04])` is `[0.03, 0.06]`. `benjaminiYekutieliAdjust([0.3, 0.3, 0.3])` is `[0.55, 0.55, 0.55]`.

## Estimating the share of true nulls

The two functions of this section live in `packages/stats/src/storey.ts`. A p-value above `lambda` is taken as coming from a true null, because real effects give small p-values.

### `storeyPiZero`
```ts
storeyPiZero(pvalues: number[], lambda: number): number
```
* **Definition.** `min(1, c / (m (1 - lambda)))`, where `c` is the number of p-values strictly greater than `lambda`. A p-value equal to `lambda` is not counted. `lambda` is in [0, 1). When no p-value is above `lambda`, the result is 0.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an empty array, for a p-value that is NaN, infinite or outside [0, 1], and for a `lambda` that is NaN, infinite, below 0 or at least 1.
* **Example.** `storeyPiZero([0.2, 0.5, 0.5, 0.7, 0.9], 0.5)` is 0.8: two p-values are above 0.5, and 2 / (5 x 0.5) is 0.8. `storeyPiZero([0.01, 0.02, 0.03, 0.04], 0.5)` is 0. `storeyPiZero([0.5], 0.25)` is 1, because 1 / 0.75 is capped.

### `storeyQValues`
```ts
storeyQValues(pvalues: number[], lambda: number): number[]
```
* **Definition.** The q-value of a p-value is the smallest false discovery rate at which it is called significant. Steps:
  1. Let `pi0 = storeyPiZero(pvalues, lambda)`.
  2. Sort the p-values ascending: `p(1) <= ... <= p(m)`.
  3. For each rank `i`, let `r(i) = pi0 m p(i) / i`.
  4. The q-value at rank `i` is the minimum of `r(j)` over all ranks `j` from `i` to m (the monotone minimum).
  5. Put the values back in the input order.

  Equal p-values get equal q-values, because the last rank of a block of ties has the smallest `r`. When `pi0` is 0, every q-value is 0. No q-value exceeds 1.
* **Returns.** An array of numbers, one per p-value, in the input order.
* **Throws.** A `RangeError` for an empty array, for a p-value that is NaN, infinite or outside [0, 1], and for a `lambda` that is NaN, infinite, below 0 or at least 1.
* **Example.** `storeyQValues([0.2, 0.5, 0.5, 0.7, 0.9], 0.5)` has `pi0` 0.8 and is `[2/3, 2/3, 2/3, 0.7, 0.72]`. `storeyQValues([0.01, 0.02, 0.03, 0.04], 0.5)` is `[0, 0, 0, 0]`. `storeyQValues([0.0, 0.3, 1.0, 0.6], 0.3)` is `[0, 0.42857142857142855, 0.7142857142857143, 0.5714285714285714]`.

## Error rates for many tests

The three functions of this section live in `packages/stats/src/rates.ts`. They take the number of tests and a level. All three use the stable forms given, so that a small level keeps its relative accuracy.

### `familywiseErrorRate`
```ts
familywiseErrorRate(m: number, alpha: number): number
```
* **Definition.** The chance of at least one false rejection in `m` independent tests of true nulls, each at level `alpha`: `1 - (1 - alpha)^m`. Compute it as `-expm1(m log1p(-alpha))`. `m` is a non-negative integer and `alpha` is in [0, 1]. The result is 0 when `m` is 0, whatever `alpha` is. It is 1 when `alpha` is 1 and `m` is at least 1.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a non-negative integer, and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `familywiseErrorRate(10, 0.05)` is 0.4012630607616211. `familywiseErrorRate(1, 0.05)` is 0.05. `familywiseErrorRate(0, 0.05)` is 0. `familywiseErrorRate(5, 1)` is 1.

### `bonferroniThreshold`
```ts
bonferroniThreshold(m: number, alpha: number): number
```
* **Definition.** The level for each of `m` tests that keeps the family-wise rate at most `alpha`: `alpha / m`. `m` is a positive integer and `alpha` is in [0, 1].
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a positive integer (0 included), and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `bonferroniThreshold(10, 0.05)` is 0.005. `bonferroniThreshold(4, 1)` is 0.25. `bonferroniThreshold(7, 0)` is 0.

### `sidakThreshold`
```ts
sidakThreshold(m: number, alpha: number): number
```
* **Definition.** The level for each of `m` independent tests that makes the family-wise rate exactly `alpha`: `1 - (1 - alpha)^(1/m)`. Compute it as `-expm1(log1p(-alpha) / m)`. `m` is a positive integer and `alpha` is in [0, 1]. The result is 1 when `alpha` is 1, and 0 when `alpha` is 0. It is never below `bonferroniThreshold(m, alpha)`.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a positive integer (0 included), and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `sidakThreshold(10, 0.05)` is 0.005116196891823702. `sidakThreshold(1, 0.05)` is 0.05. `sidakThreshold(1000, 0.05)` is 5.129197890901781e-05.

## Combining p-values

The five functions of this section live in `packages/stats/src/combine.ts`. Each turns several p-values, or several z scores, for one shared null hypothesis into one number. They do not compute a final p-value from a statistic where the section says so.

### `fisherCombinedStatistic`
```ts
fisherCombinedStatistic(pvalues: number[]): { statistic: number; df: number }
```
* **Definition.** `statistic = -2 (ln p(1) + ... + ln p(m))`, summed in the input order, and `df = 2 m`. Under independent true nulls the statistic follows a chi-square distribution with `df` degrees of freedom, so the combined p-value is its upper tail (the package's `chiSquareSf`). Every p-value is in (0, 1]. When every p-value is 1 the statistic is 0 (positive zero).
* **Returns.** An object with two fields: `statistic`, a non-negative number, and `df`, the whole number `2 m`.
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite, 0, below 0 or above 1.
* **Example.** `fisherCombinedStatistic([0.05, 0.01, 0.2])` is `{ statistic: 18.420680743952364, df: 6 }`. `fisherCombinedStatistic([0.05])` is `{ statistic: 5.991464547107982, df: 2 }`. `fisherCombinedStatistic([1, 1, 1])` is `{ statistic: 0, df: 6 }`.

### `tippettMinPCombination`
```ts
tippettMinPCombination(pvalues: number[]): number
```
* **Definition.** The chance that the smallest of `m` independent uniform p-values is at most the observed smallest: `1 - (1 - min p)^m`. Compute it as `-expm1(m log1p(-min p))`. A smallest p-value of 0 gives 0, and of 1 gives 1.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `tippettMinPCombination([0.2, 0.5, 0.01])` is 0.029701. `tippettMinPCombination([0.3, 0.3, 0.3, 0.3])` is 0.7599. `tippettMinPCombination([0.04])` is 0.04.

### `simesPValue`
```ts
simesPValue(pvalues: number[]): number
```
* **Definition.** Sort the p-values ascending. The result is the minimum over ranks `i` from 1 to m of `m p(i) / i`. It never exceeds `p(m)`, so it is at most 1. It is the p-value of the global null hypothesis that every individual null is true, valid under independence and under positive dependence of the tests.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an empty array, and for a p-value that is NaN, infinite or outside [0, 1].
* **Example.** `simesPValue([0.01, 0.04, 0.03, 0.2])` is 0.04, from the sorted values 0.01, 0.03, 0.04, 0.2 and the products 0.04, 0.06, 0.0533, 0.2. `simesPValue([0.04, 0.04, 0.04, 0.9])` is 0.05333333333333334. `simesPValue([0, 0.5])` is 0.

### `harmonicMeanPValue`
```ts
harmonicMeanPValue(pvalues: number[], weights?: number[]): number
```
* **Definition.** The weighted harmonic mean of the p-values: `sum(w) / sum(w / p)`. Weights are positive and are normalised to sum 1 first, so only their ratios matter. When `weights` is omitted, every weight is equal. This is the plain statistic, with no calibration against its null distribution. Every p-value is in (0, 1]. The result is at most the largest p-value, and equal to it when all p-values are equal.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` for an empty array, for a p-value that is NaN, infinite, 0, below 0 or above 1, for `weights` of another length than `pvalues`, and for a weight that is not positive and finite.
* **Example.** `harmonicMeanPValue([0.01, 0.04, 0.2])` is 0.023076923076923078. `harmonicMeanPValue([0.01, 0.04, 0.2], [3, 2, 1])` is 0.016901408450704227. `harmonicMeanPValue([0.2, 0.002], [10, 20])` is 0.0029850746268656717, the same as with weights `[0.1, 0.2]`.

### `stoufferCombinedZ`
```ts
stoufferCombinedZ(zs: number[], weights?: number[]): number
```
* **Definition.** `sum(w z) / sqrt(sum(w^2))`. Under independent true nulls with standard normal z scores, the result is standard normal. When `weights` is omitted, every weight is 1, so the result is `sum(z) / sqrt(m)`. Weights are not normalised, and multiplying all of them by one positive number leaves the result unchanged. A common choice for the weight of a study is the square root of its sample size. The z scores have any sign and any size, within the finite numbers.
* **Returns.** A number.
* **Throws.** A `RangeError` for an empty array, for a z score that is NaN or infinite, for `weights` of another length than `zs`, and for a weight that is not positive and finite.
* **Example.** `stoufferCombinedZ([1.64, 2.1, -0.3])` is 1.9860849260123126. `stoufferCombinedZ([1.64, 2.1, -0.3], [12, 30, 8])` is 2.4117788572582044. `stoufferCombinedZ([1.5, -1.5])` is 0. `stoufferCombinedZ([0.5, 1], [3, 4])` is 1.1.
