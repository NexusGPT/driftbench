# Sequential evidence

This page defines the mean of e-values, the rule that combines them under any dependence. It follows the conventions of [statistics capabilities](capabilities.md): the `RangeError` rules, the accuracy of 1e-11.

Status: partly built. `eValueAverage` exists in `@agent-nexus/driftbench-stats`; the other functions are planned.

## E-values

An e-value is a non-negative number whose expected value is at most 1 when the null is true. A large e-value is evidence against the null. The function below takes e-values as plain numbers: each one is at least 0 and finite. It is defined in `packages/stats/src/evalues.ts`.

### `eValueAverage`

```ts
eValueAverage(evalues: number[]): number
```

* **Definition.** The arithmetic mean: the sum of the values divided by their count. The mean of e-values is an e-value under any dependence between them.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` for an empty array and for a value that is negative, `NaN` or infinite.
* **Example.** `eValueAverage([2, 4])` is 3. `eValueAverage([0, 0, 3])` is 1. `eValueAverage([0.5, 1.5, 2, 10])` is 3.5. `eValueAverage([0.1, 0.2, 0.3, 40])` is 10.15.
