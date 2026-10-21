# Descriptive and robust statistics

Location and mean measures that the statistics package ([statistics](../concepts/statistics.md)) does not have yet. The shared rules of every function (the `RangeError` conditions, the accuracy) are in the [conventions](capabilities.md#conventions) and are not repeated here. Each section lists only the inputs it refuses beyond those rules.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

## Where the functions go

| File of `packages/stats/src` | Functions |
|---|---|
| `descriptive.ts` | `median` |
| `means.ts` | `geometricMean`, `harmonicMean` |

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
