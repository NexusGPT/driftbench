# Many comparisons and combined evidence

A report that compares many criteria, or runs many suites, makes many tests at once. The chance that at least one of them looks significant by luck grows with their number. This page defines the function that gives the level for each test so that this chance stays at most a chosen level. The conventions of the [shared page](capabilities.md#conventions) apply to every function here.

Words used in the sections:

* **m.** The number of tests.

## Error rates for many tests

The function of this section lives in `packages/stats/src/rates.ts`. It takes the number of tests and a level.

### `bonferroniThreshold`
```ts
bonferroniThreshold(m: number, alpha: number): number
```
* **Definition.** The level for each of `m` tests that keeps the family-wise rate at most `alpha`: `alpha / m`. `m` is a positive integer and `alpha` is in [0, 1].
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a positive integer (0 included), and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `bonferroniThreshold(10, 0.05)` is 0.005. `bonferroniThreshold(4, 1)` is 0.25. `bonferroniThreshold(7, 0)` is 0.
