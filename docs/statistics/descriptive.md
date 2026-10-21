# Descriptive and robust statistics

Location, spread, mean and correlation measures that the statistics package ([statistics](../concepts/statistics.md)) does not have yet. The shared rules of every function (the `RangeError` conditions, the accuracy, the mid-rank rule for ties) are in the [conventions](capabilities.md#conventions) and are not repeated here. Each section lists only the inputs it refuses beyond those rules.

Status: partly built. `median`, `geometricMean` and `harmonicMean` exist in `@agent-nexus/driftbench-stats`; the other functions are planned.

## Where the functions go

| File of `packages/stats/src` | Functions |
|---|---|
| `descriptive.ts` | `median`, `coefficientOfVariation`, `mode`, `weightedMedian` |
| `means.ts` | `geometricMean`, `harmonicMean` |
| `correlation.ts` | `sampleCovariance`, `pearsonCorrelation`, `spearmanRho`, `kendallTauB` |

Every function takes plain arrays of numbers and returns a number. No function changes its input: a function that sorts works on a copy.

## Location and spread

### `median`
```ts
median(xs: number[]): number
```
* **Definition.** The middle value of the sorted values. With an even count, the mean of the two middle values: `(a + b) / 2`.
* **Returns.** A number. For one value, that value.
* **Throws.** A `RangeError` for an empty array, and for the shared conditions.
* **Example.** `median([5, 1, 4, 2, 3])` is 3. `median([1, 2, 3, 4])` is 2.5. `median([412, 380, 395, 1210, 402, 388])` is 398.5.

### `coefficientOfVariation`
```ts
coefficientOfVariation(xs: number[]): number
```
* **Definition.** The sample standard deviation (the square root of the sample variance, divided by `n - 1`) divided by the absolute value of the mean `sum / n`. When all values are equal (compared with `===`) and the mean is not 0, the result is 0.
* **Returns.** A number, zero or more.
* **Throws.** A `RangeError` for fewer than two values, and when the mean is 0 (the ratio is undefined). The check for a zero mean comes first, so `[0, 0]` throws.
* **Example.** `coefficientOfVariation([1, 3])` is 0.7071067811865476. `coefficientOfVariation([-4, -6, -5])` is 0.2, because the sample standard deviation is 1 and the absolute mean is 5. `coefficientOfVariation([10, 10])` is 0.

### `mode`
```ts
mode(xs: number[]): number
```
* **Definition.** The value that occurs most often. Values are equal when `===` says so, so `0` and `-0` are the same value. When several values share the highest count, the smallest of them is the result.
* **Returns.** A number, one of the input values. If the result is a zero, it is `0`.
* **Throws.** A `RangeError` for an empty array, and for the shared conditions.
* **Example.** `mode([1, 2, 2, 3])` is 2. `mode([1, 1, 2, 2])` is 1. `mode([4, 5, 5, 3, 4, 5, 2, 4])` is 4: the values 4 and 5 both occur three times.

### `weightedMedian`
```ts
weightedMedian(xs: number[], weights: number[]): number
```
* **Definition.** The lower weighted median. Let `W` be the sum of the weights, added in input order. Sort the pairs `(x, weight)` by `x`, with equal values in input order, and add the weights in that order. The result is the `x` of the first pair at which the cumulative weight is `W / 2` or more. Equal values share their weight, so the result is the smallest `x` with `weight(values <= x) >= W / 2`. When the cumulative weight is exactly `W / 2`, the lower value is taken. With equal weights the result is the lower median: `weightedMedian([1, 2], [1, 1])` is 1, while `median([1, 2])` is 1.5. For weights whose sums are exact (integers, halves, quarters) the comparison at exactly `W / 2` is exact; with other weights a sum can fall on either side of `W / 2` by rounding, and the result there is not specified.
* **Returns.** A number, one of the values of `xs`.
* **Throws.** A `RangeError` when a weight is 0 or negative, for an empty array, and for the shared conditions (a length mismatch, a `NaN` or infinite value or weight).
* **Example.** `weightedMedian([1, 2, 3], [1, 1, 5])` is 3: the total is 7, and the cumulative weights are 1, 2 and 7. `weightedMedian([30, 10, 40, 20], [0.25, 0.25, 0.25, 0.25])` is 20: the cumulative weight reaches the half, 0.5, at 20.

## Means

### `geometricMean`
```ts
geometricMean(xs: number[]): number
```
* **Definition.** The `n`-th root of the product of the values, computed as `Math.exp(sum(Math.log(x)) / n)`, so a long array does not overflow or underflow the product.
* **Returns.** A number, positive.
* **Throws.** A `RangeError` when any value is 0 or negative, for an empty array, and for the shared conditions.
* **Example.** `geometricMean([1, 2, 4])` is 2. `geometricMean([1, 10, 100])` is 10. `geometricMean([1.1, 0.95, 1.2, 1.05])` is 1.071202823901392. `geometricMean` of 400 copies of `1e10` is `1e10`.

### `harmonicMean`
```ts
harmonicMean(xs: number[]): number
```
* **Definition.** `n / sum(1 / x)`.
* **Returns.** A number, positive.
* **Throws.** A `RangeError` when any value is 0 or negative, for an empty array, and for the shared conditions.
* **Example.** `harmonicMean([40, 60])` is 48. `harmonicMean([1, 2, 4])` is 1.7142857142857142 (12 / 7). `harmonicMean([1, 4, 4])` is 2.

## Correlation

In the three correlation functions the two arrays hold the paired values `(xs[i], ys[i])` and must have the same length, as the shared conventions say. They need at least two pairs.

### `sampleCovariance`
```ts
sampleCovariance(xs: number[], ys: number[]): number
```
* **Definition.** `sum((x_i - meanX) * (y_i - meanY)) / (n - 1)`.
* **Returns.** A number, negative, zero or positive. It is 0 when either array has all values equal.
* **Throws.** A `RangeError` for fewer than two pairs, and for the shared conditions (a length mismatch, a `NaN` or infinite value).
* **Example.** `sampleCovariance([1, 2, 3, 4], [2, 4, 6, 8])` is 3.3333333333333335 (10 / 3). `sampleCovariance([4, 1, 3, 2], [1, 4, 2, 3])` is -1.6666666666666667. `sampleCovariance([1, 3], [2, 8])` is 6.

### `pearsonCorrelation`
```ts
pearsonCorrelation(xs: number[], ys: number[]): number
```
* **Definition.** `Sxy / sqrt(Sxx * Syy)`, where `Sxx`, `Syy` and `Sxy` are the sums of squared and cross deviations from the means. When all values of `xs` are equal, or all values of `ys` are equal (compared with `===`), the correlation is not defined and the result is 0. The result is limited to the range [-1, 1].
* **Returns.** A number between -1 and 1.
* **Throws.** A `RangeError` for fewer than two pairs, and for the shared conditions.
* **Example.** `pearsonCorrelation([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])` is 0.8. `pearsonCorrelation([1, 2, 3], [9, 6, 3])` is -1. `pearsonCorrelation([1, 2, 3], [4, 4, 4])` is 0.

### `spearmanRho`
```ts
spearmanRho(xs: number[], ys: number[]): number
```
* **Definition.** Replace each array by its mid-ranks (1-based; tied values share the average of the ranks they take, see the shared conventions), then take `pearsonCorrelation` of the two rank arrays. When all values of one array are equal, its ranks are all equal and the result is 0.
* **Returns.** A number between -1 and 1.
* **Throws.** A `RangeError` for fewer than two pairs, and for the shared conditions.
* **Example.** `spearmanRho([1, 2, 3, 4], [1, 8, 27, 64])` is 1. For `[1, 2, 2, 3]` and `[1, 3, 2, 2]` the ranks are 1, 2.5, 2.5, 4 and 1, 4, 2.5, 2.5, and `spearmanRho` is 0.5.

### `kendallTauB`
```ts
kendallTauB(xs: number[], ys: number[]): number
```
* **Definition.** `tau_b = (C - D) / sqrt((n0 - n1) * (n0 - n2))`. Take every pair of positions `i < j`. The pair is concordant when `(xs[i] - xs[j]) * (ys[i] - ys[j]) > 0`, giving `C`, and discordant when the product is below 0, giving `D`. A pair tied in `xs`, in `ys` or in both is neither. `n0 = n * (n - 1) / 2`. `n1` is the number of pairs tied in `xs` (the sum of `t * (t - 1) / 2` over groups of `t` equal values) and `n2` the same for `ys`. When `(n0 - n1) * (n0 - n2)` is 0 (all values of one array are equal), the result is 0.
* **Returns.** A number between -1 and 1.
* **Throws.** A `RangeError` for fewer than two pairs, and for the shared conditions.
* **Example.** `kendallTauB([1, 2, 3, 4, 5], [3, 1, 2, 5, 4])` has 7 concordant and 3 discordant pairs and is 0.4. For `[1, 2, 2, 3]` and `[1, 3, 2, 2]` there are 3 concordant pairs, 1 discordant pair and one tie in each array, so `n0 = 6`, `n1 = n2 = 1` and the result is `2 / 5 = 0.4`. `kendallTauB([1, 2], [2, 1])` is -1.
