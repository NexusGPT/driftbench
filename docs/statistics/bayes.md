# Upper bound on a rate

This page defines one function that the statistics package ([statistics](../concepts/statistics.md)) does not have yet: `ruleOfThreeUpperBound`, an exact one-sided upper bound on a failure rate after `n` trials with no failure. The conventions of [statistics capabilities](capabilities.md) hold for it: the `RangeError` rules and the accuracy of a relative 1e-11.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

## Intervals on a rate

The function is defined in `packages/stats/src/intervals.ts`.

### `ruleOfThreeUpperBound`
```ts
ruleOfThreeUpperBound(n: number, confidence: number): number
```
* **Definition.** The exact one-sided upper bound on a failure rate after `n` trials with no failure: `1 - (1 - confidence)^(1/n)`. It is the rate `U` with `(1 - U)^n = 1 - confidence`. The rule of three, `3 / n`, approximates it for a confidence of 0.95. Compute it as `-expm1(log1p(-confidence) / n)` so that a large `n` does not lose digits to the subtraction. For `n = 1` the result is `confidence`.
* **Returns.** A number in (0, 1).
* **Throws.** A `RangeError` when `n` is 0. A `RangeError` when `confidence` is not strictly between 0 and 1.
* **Example.** `ruleOfThreeUpperBound(59, 0.95)` is about 0.0495076. `ruleOfThreeUpperBound(1, 0.95)` is 0.95. `ruleOfThreeUpperBound(1000, 0.95)` is about 0.00299125.
* **File.** `packages/stats/src/intervals.ts`.
