# Beta tail and an upper bound on a rate

This page defines two functions that the statistics package ([statistics](../concepts/statistics.md)) does not have yet: the upper tail of a Beta distribution and the exact upper bound on a failure rate after trials without a failure. The conventions of [statistics capabilities](capabilities.md) hold for both: the `RangeError` rules, the accuracy of a relative 1e-11, and the quantile `z` passed in as an argument.

Status: partly built. `ruleOfThreeUpperBound` and `betaTailProbability` exist in `@agent-nexus/driftbench-stats`; the other functions are planned.

## Beta tail

The function of this section is defined in `packages/stats/src/bayes.ts`.

### `betaTailProbability`
```ts
betaTailProbability(a: number, b: number, x: number): number
```
* **Definition.** `P(X > x)` for `X` with a `Beta(a, b)` distribution, `a` and `b` integer. With `N = a + b - 1` the result is the finite sum `sum over j = 0 to a - 1 of C(N, j) x^j (1 - x)^(N - j)`. The sum is the probability that a Binomial with `N` trials and rate `x` gives at most `a - 1` successes. In the term `j = 0` the factor `x^0` is 1 for every `x`, including `x = 0`. All terms are non-negative, so the sum is stable.
* **Returns.** A number in [0, 1]. It is 1 for `x = 0` and 0 for `x = 1`.
* **Throws.** A `RangeError` when `x` is outside [0, 1]. A `RangeError` when `a` or `b` is not a whole number of at least 1.
* **Example.** `betaTailProbability(2, 3, 0.5)` is 5/16, which is 0.3125. `betaTailProbability(1, 5, 0.1)` is `0.9^5`, about 0.59049. `betaTailProbability(10, 30, 0.2)` is about 0.758641.
* **File.** `packages/stats/src/bayes.ts`.

## Upper bound on a rate

The function of this section is defined in `packages/stats/src/intervals.ts`.

### `ruleOfThreeUpperBound`
```ts
ruleOfThreeUpperBound(n: number, confidence: number): number
```
* **Definition.** The exact one-sided upper bound on a failure rate after `n` trials with no failure: `1 - (1 - confidence)^(1/n)`. It is the rate `U` with `(1 - U)^n = 1 - confidence`. The rule of three, `3 / n`, approximates it for a confidence of 0.95. Compute it as `-expm1(log1p(-confidence) / n)` so that a large `n` does not lose digits to the subtraction. For `n = 1` the result is `confidence`.
* **Returns.** A number in (0, 1).
* **Throws.** A `RangeError` when `n` is 0. A `RangeError` when `confidence` is not strictly between 0 and 1.
* **Example.** `ruleOfThreeUpperBound(59, 0.95)` is about 0.0495076. `ruleOfThreeUpperBound(1, 0.95)` is 0.95. `ruleOfThreeUpperBound(1000, 0.95)` is about 0.00299125.
* **File.** `packages/stats/src/intervals.ts`.
