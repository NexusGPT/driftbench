# Bayesian summaries and rate intervals

This page defines fourteen functions that the statistics package ([statistics](../concepts/statistics.md)) does not have yet. Nine summarise a pass rate with a Beta prior: the posterior mode and variance, the chance of the next success, the Beta-Binomial and Dirichlet-Multinomial distributions, a Bayes factor against a point null, and comparisons of two Beta variables. Five give a closed-form confidence interval on a rate from `k` successes in `n` trials. The conventions of [statistics capabilities](capabilities.md) hold for all of them: the `RangeError` rules, the accuracy of a relative 1e-11, and the quantile `z` passed in as an argument.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

## Notation

* A prior `Beta(a, b)` on a pass rate has two shape parameters, `a` and `b`. Both are positive numbers, not necessarily whole.
* After `successes` passes and `failures` fails, the posterior is `Beta(A, B)` with `A = a + successes` and `B = b + failures`.
* `B(x, y)` is the Beta function. For whole numbers it is `(x - 1)! (y - 1)! / (x + y - 1)!`.
* A function marked "integer" below requires whole shape parameters, each at least 1 and a safe integer, and throws a `RangeError` for any other value. This makes its exact answer a rational number.
* `C(n, j)` is the binomial coefficient.

## Beta-Binomial summaries

These nine functions are defined in `packages/stats/src/bayes.ts`.

### `betaPosteriorMode`
```ts
betaPosteriorMode(a: number, b: number, successes: number, failures: number): number
```
* **Definition.** The mode of the posterior `Beta(A, B)`, which is `(A - 1) / (A + B - 2)`. The mode is the rate where the posterior density is highest.
* **Returns.** A number in (0, 1).
* **Throws.** A `RangeError` when `a` or `b` is not positive. A `RangeError` when `A` is not above 1 or `B` is not above 1, because the density then has no interior mode. This includes `a = b = 1` with no data.
* **Example.** `betaPosteriorMode(1, 1, 7, 3)` is 0.7. `betaPosteriorMode(1.5, 2.5, 10, 4)` is 0.65625. `betaPosteriorMode(1, 1, 5, 0)` throws.
* **File.** `packages/stats/src/bayes.ts`.

### `betaPosteriorVariance`
```ts
betaPosteriorVariance(a: number, b: number, successes: number, failures: number): number
```
* **Definition.** The variance of the posterior `Beta(A, B)`, which is `A B / ((A + B)^2 (A + B + 1))`.
* **Returns.** A number, positive.
* **Throws.** A `RangeError` when `a` or `b` is not positive.
* **Example.** `betaPosteriorVariance(1, 1, 0, 0)` is 1/12, about 0.0833333. `betaPosteriorVariance(1, 1, 7, 3)` is 2/117, about 0.017094. `betaPosteriorVariance(3, 7, 120, 380)` is about 0.000358142.
* **File.** `packages/stats/src/bayes.ts`.

### `predictiveProbabilityNext`
```ts
predictiveProbabilityNext(a: number, b: number, successes: number, failures: number): number
```
* **Definition.** The probability that the next trial is a success, given the data: `(a + successes) / (a + b + successes + failures)`. This is the mean of the posterior.
* **Returns.** A number in (0, 1).
* **Throws.** A `RangeError` when `a` or `b` is not positive.
* **Example.** `predictiveProbabilityNext(1, 1, 7, 3)` is 2/3. `predictiveProbabilityNext(0.5, 0.5, 0, 0)` is 0.5. `predictiveProbabilityNext(1, 1, 0, 10)` is 1/12.
* **File.** `packages/stats/src/bayes.ts`.

### `betaBinomialPmf`
```ts
betaBinomialPmf(k: number, n: number, a: number, b: number): number
```
* **Definition.** The probability of exactly `k` successes in `n` trials when the success rate has a `Beta(a, b)` prior, with `a` and `b` integer. It is `C(n, k) B(k + a, n - k + b) / B(a, b)`, which is `C(n, k) (k + a - 1)! (n - k + b - 1)! (a + b - 1)! / ((n + a + b - 1)! (a - 1)! (b - 1)!)`. An equal form is `C(n, k) (a)_k (b)_(n-k) / (a + b)_n`, where `(x)_m` is the rising product `x (x + 1) ... (x + m - 1)`. Build the result from ratios of small factors so that no huge factorial overflows. With `n = 0` and `k = 0` the result is 1.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when `k` is greater than `n`. A `RangeError` when `a` or `b` is not a whole number of at least 1.
* **Example.** `betaBinomialPmf(3, 10, 1, 1)` is 1/11. With `a = b = 1` every `k` from 0 to `n` has probability `1 / (n + 1)`. `betaBinomialPmf(5, 5, 2, 3)` is 1/21. `betaBinomialPmf(12, 30, 2, 2)` is about 0.0452713.
* **File.** `packages/stats/src/bayes.ts`.

### `bayesFactorBinomialPointNull`
```ts
bayesFactorBinomialPointNull(successes: number, trials: number, p0: number): number
```
* **Definition.** The Bayes factor `BF10` for the alternative "the rate is unknown, with a uniform prior" against the null "the rate is exactly `p0`", for `successes` out of `trials`. It is `[successes! (trials - successes)! / (trials + 1)!] / [p0^successes (1 - p0)^(trials - successes)]`. The numerator is the probability of one fixed sequence of results, averaged over the uniform prior; it equals `1 / ((trials + 1) C(trials, successes))`. The denominator is the probability of the same sequence under `p0`. A value above 1 favours the alternative and a value below 1 favours the null. With `trials = 0` the result is 1.
* **Returns.** A number, positive.
* **Throws.** A `RangeError` when `successes` is greater than `trials`. A `RangeError` when `p0` is not strictly between 0 and 1.
* **Example.** `bayesFactorBinomialPointNull(7, 10, 0.5)` is 128/165, about 0.775758. `bayesFactorBinomialPointNull(18, 20, 0.5)` is about 262.801. `bayesFactorBinomialPointNull(50, 100, 0.5)` is about 0.124401.
* **File.** `packages/stats/src/bayes.ts`.

### `posteriorOddsBinomial`
```ts
posteriorOddsBinomial(successes: number, trials: number, p0: number, priorOdds: number): number
```
* **Definition.** The posterior odds of the alternative against the null: `priorOdds` times `bayesFactorBinomialPointNull(successes, trials, p0)`. The prior odds are the prior probability of the alternative divided by the prior probability of the null.
* **Returns.** A number, positive.
* **Throws.** A `RangeError` when `priorOdds` is zero or negative. The `successes`, `trials` and `p0` rules are those of `bayesFactorBinomialPointNull`.
* **Example.** `posteriorOddsBinomial(7, 10, 0.5, 1)` is 128/165, about 0.775758. `posteriorOddsBinomial(7, 10, 0.5, 0.25)` is 32/165, about 0.193939. `posteriorOddsBinomial(0, 0, 0.5, 3)` is 3.
* **File.** `packages/stats/src/bayes.ts`.

### `betaTailProbability`
```ts
betaTailProbability(a: number, b: number, x: number): number
```
* **Definition.** `P(X > x)` for `X` with a `Beta(a, b)` distribution, `a` and `b` integer. With `N = a + b - 1` the result is the finite sum `sum over j = 0 to a - 1 of C(N, j) x^j (1 - x)^(N - j)`. The sum is the probability that a Binomial with `N` trials and rate `x` gives at most `a - 1` successes. In the term `j = 0` the factor `x^0` is 1 for every `x`, including `x = 0`. All terms are non-negative, so the sum is stable.
* **Returns.** A number in [0, 1]. It is 1 for `x = 0` and 0 for `x = 1`.
* **Throws.** A `RangeError` when `x` is outside [0, 1]. A `RangeError` when `a` or `b` is not a whole number of at least 1.
* **Example.** `betaTailProbability(2, 3, 0.5)` is 5/16, which is 0.3125. `betaTailProbability(1, 5, 0.1)` is `0.9^5`, about 0.59049. `betaTailProbability(10, 30, 0.2)` is about 0.758641.
* **File.** `packages/stats/src/bayes.ts`.

### `posteriorProbabilityBetaGreater`
```ts
posteriorProbabilityBetaGreater(a1: number, b1: number, a2: number, b2: number): number
```
* **Definition.** `P(X1 > X2)` for independent `X1` with a `Beta(a1, b1)` distribution and `X2` with a `Beta(a2, b2)` distribution, all four parameters integer. With `N = a1 + b1 - 1` the exact finite formula is `(1 / B(a2, b2)) * sum over j = 0 to a1 - 1 of C(N, j) B(a2 + j, a1 + b1 + b2 - 1 - j)`. It conditions on `X2`, and the inner sum is the tail sum of `betaTailProbability`. All terms are positive. Two continuous variables are never equal, so `P(X1 > X2) + P(X2 > X1) = 1`.
* **Returns.** A number in (0, 1).
* **Throws.** A `RangeError` when any of the four parameters is not a whole number of at least 1.
* **Example.** `posteriorProbabilityBetaGreater(2, 1, 1, 1)` is 2/3. `posteriorProbabilityBetaGreater(1, 1, 7, 1)` is 1/8. Equal parameters give 1/2. `posteriorProbabilityBetaGreater(13, 9, 10, 12)` is about 0.822851.
* **File.** `packages/stats/src/bayes.ts`.

### `dirichletMultinomialPmf`
```ts
dirichletMultinomialPmf(counts: number[], alphas: number[]): number
```
* **Definition.** The probability of the counts `x_1, ..., x_K` in `n = x_1 + ... + x_K` trials of `K` categories when the category rates have a `Dirichlet(alphas)` prior, with every alpha integer. With `A = alpha_1 + ... + alpha_K` the result is `[n! / (x_1! ... x_K!)] * [(A - 1)! / (A + n - 1)!] * product over i of [(alpha_i + x_i - 1)! / (alpha_i - 1)!]`. An equal form uses rising products: `[n! / (x_1! ... x_K!)] * (alpha_1)_(x_1) ... (alpha_K)_(x_K) / (A)_n`. For `K = 1` the result is 1. If every count is 0 the result is 1. If every alpha is 1 the result is `1 / C(n + K - 1, K - 1)`.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` for an empty `counts` array. A `RangeError` when `counts` and `alphas` have different lengths. A `RangeError` when an alpha is not a whole number of at least 1.
* **Example.** `dirichletMultinomialPmf([3, 1, 2], [1, 2, 1])` is 1/42, about 0.0238095. `dirichletMultinomialPmf([12, 5, 3], [1, 1, 1])` is 1/231. `dirichletMultinomialPmf([4, 0], [2, 3])` is 1/14.
* **File.** `packages/stats/src/bayes.ts`.

## Intervals on a rate

The first four of these five functions give an interval for the rate behind `k` successes in `n` trials. In each of them `p̂ = k / n`, and `z` is the normal quantile passed in by the caller, for example `Z95` for a 95 percent two-sided interval. The result is the object `{ lower, upper }`. Each bound is clipped: `lower` is the larger of 0 and the computed lower bound, and `upper` is the smaller of 1 and the computed upper bound. The functions are defined in `packages/stats/src/intervals.ts`.

The first four functions share these `RangeError` conditions, in addition to the shared conventions: `n` is 0, `k` is greater than `n`, and `z` is zero or negative. `ruleOfThreeUpperBound` takes no `k` and no `z`.

### `agrestiCoullInterval`
```ts
agrestiCoullInterval(k: number, n: number, z: number): { lower: number; upper: number }
```
* **Definition.** Let `ñ = n + z^2` and `p̃ = (k + z^2 / 2) / ñ`. The bounds are `p̃ - z * sqrt(p̃ (1 - p̃) / ñ)` and `p̃ + z * sqrt(p̃ (1 - p̃) / ñ)`, then clipped. The bounds can fall outside [0, 1] for `k` near 0 or `n`, and the clip applies.
* **Returns.** An object with the number fields `lower` and `upper`.
* **Throws.** The conditions listed above for the intervals.
* **Example.** `agrestiCoullInterval(7, 10, Z95)` is `{ lower: 0.392325, upper: 0.896662 }`. `agrestiCoullInterval(0, 20, Z95)` has `lower` 0 after clipping and `upper` about 0.189810. `agrestiCoullInterval(20, 20, Z95)` has `lower` about 0.810190 and `upper` 1 after clipping.
* **File.** `packages/stats/src/intervals.ts`.

### `plusFourInterval`
```ts
plusFourInterval(k: number, n: number, z: number): { lower: number; upper: number }
```
* **Definition.** Add 2 successes and 2 failures, then apply the Wald interval to the new counts. With `k' = k + 2`, `n' = n + 4` and `p' = k' / n'` the bounds are `p' - z * sqrt(p' (1 - p') / n')` and `p' + z * sqrt(p' (1 - p') / n')`, then clipped. The value of `z` is used as passed.
* **Returns.** An object with the number fields `lower` and `upper`.
* **Throws.** The conditions listed above for the intervals.
* **Example.** `plusFourInterval(7, 10, Z95)` is `{ lower: 0.391864, upper: 0.893851 }`. `plusFourInterval(0, 1, Z95)` has `lower` 0 after clipping and `upper` about 0.829407. `plusFourInterval(2, 30, 1)` is `{ lower: 0.062392, upper: 0.172902 }`.
* **File.** `packages/stats/src/intervals.ts`.

### `logitWaldInterval`
```ts
logitWaldInterval(k: number, n: number, z: number): { lower: number; upper: number }
```
* **Definition.** The Wald interval on the log odds, mapped back to a rate. Let `L = ln(k / (n - k))` and `se = sqrt(1 / k + 1 / (n - k))`. The bounds are `expit(L - z * se)` and `expit(L + z * se)`, where `expit(u) = 1 / (1 + e^(-u))`. Both bounds are strictly inside (0, 1), so the clip changes nothing.
* **Returns.** An object with the number fields `lower` and `upper`.
* **Throws.** A `RangeError` when `k` is 0 or when `k` equals `n`, because the log odds are then infinite. The other conditions listed above for the intervals also apply.
* **Example.** `logitWaldInterval(7, 10, Z95)` is `{ lower: 0.376318, upper: 0.900232 }`. `logitWaldInterval(1, 2, Z95)` is `{ lower: 0.0588668, upper: 0.941133 }`. `logitWaldInterval(0, 10, Z95)` throws.
* **File.** `packages/stats/src/intervals.ts`.

### `wilsonContinuityInterval`
```ts
wilsonContinuityInterval(k: number, n: number, z: number): { lower: number; upper: number }
```
* **Definition.** The Wilson interval with the continuity correction of Newcombe. Let `D = 2 (n + z^2)`. Then `lower = (2k + z^2 - 1 - z * sqrt(z^2 - 2 - 1/n + 4k (n - k + 1) / n)) / D` for `k >= 1`, and `lower = 0` for `k = 0`. Also `upper = (2k + z^2 + 1 + z * sqrt(z^2 + 2 - 1/n + 4k (n - k - 1) / n)) / D` for `k <= n - 1`, and `upper = 1` for `k = n`. The result is then clipped. The lower bound solves `p̂ - p - 1/(2n) = z * sqrt(p (1 - p) / n)` and the upper bound solves `p - p̂ - 1/(2n) = z * sqrt(p (1 - p) / n)`. Both square roots have a positive argument in the range where the formula applies.
* **Returns.** An object with the number fields `lower` and `upper`.
* **Throws.** The conditions listed above for the intervals.
* **Example.** `wilsonContinuityInterval(7, 10, Z95)` is `{ lower: 0.353671, upper: 0.919052 }`. `wilsonContinuityInterval(0, 20, Z95)` is `{ lower: 0, upper: 0.200453 }`. `wilsonContinuityInterval(20, 20, Z95)` has `lower` about 0.799547 and `upper` 1.
* **File.** `packages/stats/src/intervals.ts`.

### `ruleOfThreeUpperBound`
```ts
ruleOfThreeUpperBound(n: number, confidence: number): number
```
* **Definition.** The exact one-sided upper bound on a failure rate after `n` trials with no failure: `1 - (1 - confidence)^(1/n)`. It is the rate `U` with `(1 - U)^n = 1 - confidence`. The rule of three, `3 / n`, approximates it for a confidence of 0.95. Compute it as `-expm1(log1p(-confidence) / n)` so that a large `n` does not lose digits to the subtraction. For `n = 1` the result is `confidence`.
* **Returns.** A number in (0, 1).
* **Throws.** A `RangeError` when `n` is 0. A `RangeError` when `confidence` is not strictly between 0 and 1.
* **Example.** `ruleOfThreeUpperBound(59, 0.95)` is about 0.0495076. `ruleOfThreeUpperBound(1, 0.95)` is 0.95. `ruleOfThreeUpperBound(1000, 0.95)` is about 0.00299125.
* **File.** `packages/stats/src/intervals.ts`.
