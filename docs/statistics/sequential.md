# Sequential evidence

This page defines the functions that decide an evaluation while the data arrive: Wald's sequential probability ratio test for a pass rate, a Gaussian mixture test with its confidence sequence, e-values and the rules to combine them, and the spending and boundary rules of group sequential designs. It follows the conventions of [statistics capabilities](capabilities.md): the `RangeError` rules, the accuracy of 1e-11, and the rule that a normal quantile is an argument and never computed.

Status: partly built. `eValueAverage` exists in `@agent-nexus/driftbench-stats`; the other functions are planned.

Every logarithm is the natural logarithm. A "pass rate" is the probability that one trial succeeds. The null rate is `p0` and the alternative rate is `p1`.

| Section | File in `packages/stats/src` | Functions |
|---|---|---|
| Sequential probability ratio test | `sprt.ts` | `sprtBoundaries`, `sprtLogLikelihoodRatioBernoulli`, `sprtDecisionBernoulli`, `sprtExpectedSampleSizeBernoulli` |
| Gaussian mixture | `mixture.ts` | `mixtureLogEValueNormal`, `confidenceSequenceRadiusNormal` |
| E-values | `evalues.ts` | `eValueSimpleVsSimpleBernoulli`, `eValueBetaMixtureBernoulli`, `eValueProduct`, `eValueRunningProduct`, `eValueAverage`, `eValueToPValue`, `eBenjaminiHochbergRejections`, `kellyFractionBernoulli` |
| Spending and boundaries | `spending.ts` | `pocockAlphaSpending`, `groupSequentialBoundariesObrienFleming` |

## Sequential probability ratio test

The test watches the log likelihood ratio of a stream of pass or fail trials. It stops when the ratio leaves the interval between two boundaries. The type I error `alpha` is the chance to reject the null when the true rate is `p0`. The type II error `beta` is the chance to accept the null when the true rate is `p1`.

### `sprtBoundaries`

```ts
sprtBoundaries(alpha: number, beta: number): SprtBoundaries
```

* **Definition.** `lower = ln(beta / (1 - alpha))` and `upper = ln((1 - beta) / alpha)`. The test accepts the null when the log likelihood ratio reaches `lower` or less. It rejects the null when the ratio reaches `upper` or more.
* **Returns.** An object `{ lower, upper }` of type `SprtBoundaries`, with `lower < 0 < upper`.
* **Throws.** A `RangeError` unless `alpha` and `beta` are both in the open interval (0, 1) and `alpha + beta < 1`.
* **Example.** `sprtBoundaries(0.05, 0.2)` is `{ lower: -1.5581446180465497, upper: 2.772588722239781 }`. `sprtBoundaries(0.05, 0.05)` is `{ lower: -2.9444389791664403, upper: 2.9444389791664403 }`.

### `sprtLogLikelihoodRatioBernoulli`

```ts
sprtLogLikelihoodRatioBernoulli(successes: number, trials: number, p0: number, p1: number): number
```

* **Definition.** The log of `p1^k (1 - p1)^(n - k)` over `p0^k (1 - p0)^(n - k)`, with `k = successes` and `n = trials`. Compute it as `k ln(p1 / p0) + (n - k) ln((1 - p1) / (1 - p0))`. A positive value favors `p1`. With `trials = 0` the value is 0. A term whose count is 0 contributes 0.
* **Returns.** A number.
* **Throws.** A `RangeError` when `successes > trials`, when `p0` or `p1` is outside the open interval (0, 1), or when `p0 === p1`.
* **Example.** `sprtLogLikelihoodRatioBernoulli(14, 20, 0.5, 0.7)` is 1.645657570101037. `sprtLogLikelihoodRatioBernoulli(0, 10, 0.5, 0.9)` is -16.094379124341007. `sprtLogLikelihoodRatioBernoulli(0, 0, 0.5, 0.7)` is 0.

### `sprtDecisionBernoulli`

```ts
sprtDecisionBernoulli(successes: number, trials: number, p0: number, p1: number, alpha: number, beta: number): 'accept-null' | 'reject-null' | 'continue'
```

* **Definition.** Let `llr` be the value of `sprtLogLikelihoodRatioBernoulli(successes, trials, p0, p1)` and let `lower` and `upper` be the fields of `sprtBoundaries(alpha, beta)`. The result is `'reject-null'` when `llr >= upper`. Otherwise it is `'accept-null'` when `llr <= lower`. Otherwise it is `'continue'`. Both comparisons include equality. The comparisons use the doubles that the two functions return, so an input whose exact log ratio equals a boundary is decided by the rounding of those doubles.
* **Returns.** One of the three strings `'accept-null'`, `'reject-null'` and `'continue'`.
* **Throws.** A `RangeError` for every condition of `sprtLogLikelihoodRatioBernoulli` and of `sprtBoundaries`.
* **Example.** `sprtDecisionBernoulli(10, 10, 0.5, 0.9, 0.05, 0.2)` is `'reject-null'`, because the log ratio 5.877866649021191 is above 2.772588722239781. `sprtDecisionBernoulli(6, 10, 0.5, 0.7, 0.05, 0.2)` is `'continue'`, because the log ratio -0.024469075336684937 is between the boundaries. `sprtDecisionBernoulli(3, 20, 0.6, 0.4, 0.05, 0.1)` is `'reject-null'`: when `p1` is below `p0`, few successes favor `p1`.

### `sprtExpectedSampleSizeBernoulli`

```ts
sprtExpectedSampleSizeBernoulli(p0: number, p1: number, alpha: number, beta: number, truth: number): number
```

* **Definition.** Wald's approximation of the average number of trials when the true rate is `truth`. Let `L = ln(beta / (1 - alpha))` and `U = ln((1 - beta) / alpha)`. If `truth === p0`, the value is `((1 - alpha) L + alpha U) / (p0 ln(p1 / p0) + (1 - p0) ln((1 - p1) / (1 - p0)))`. If `truth === p1`, the value is `(beta L + (1 - beta) U) / (p1 ln(p1 / p0) + (1 - p1) ln((1 - p1) / (1 - p0)))`. The value is not rounded to an integer. The approximation ignores the overshoot of the boundaries.
* **Returns.** A positive number.
* **Throws.** A `RangeError` when `truth` is neither `p0` nor `p1` (compared with `===`, so `NaN` throws), and for every condition of `sprtLogLikelihoodRatioBernoulli` on `p0` and `p1` and of `sprtBoundaries` on `alpha` and `beta`.
* **Example.** `sprtExpectedSampleSizeBernoulli(0.5, 0.7, 0.05, 0.2, 0.5)` is 15.38952552631746. `sprtExpectedSampleSizeBernoulli(0.5, 0.7, 0.05, 0.2, 0.7)` is 23.169365107535313. `sprtExpectedSampleSizeBernoulli(0.7, 0.5, 0.05, 0.2, 0.7)` is 16.304825200662666.

## Gaussian mixture

Observations have a known standard deviation `sigma`. The null says the mean is 0. The alternative puts a normal prior with mean 0 and standard deviation `tau` on the mean. The likelihood ratio of the data against the null, averaged over that prior, is an e-value at every sample size. It stays a valid e-value when the sample size is chosen by looking at the data.

### `mixtureLogEValueNormal`

```ts
mixtureLogEValueNormal(n: number, mean: number, sigma: number, tau: number): number
```

* **Definition.** `n` is the number of observations and `mean` is their sample mean. The mixture likelihood ratio is `sqrt(sigma^2 / (sigma^2 + n tau^2)) exp(n^2 mean^2 tau^2 / (2 sigma^2 (sigma^2 + n tau^2)))`. The function returns its natural logarithm, `0.5 ln(sigma^2 / (sigma^2 + n tau^2)) + n^2 mean^2 tau^2 / (2 sigma^2 (sigma^2 + n tau^2))`. It never forms the ratio itself. The value depends on `mean` only through `mean^2`. With `n = 0` the value is 0.
* **Returns.** A number. It is negative when the mean is near 0 and large when the mean is far from 0.
* **Throws.** A `RangeError` when `sigma <= 0` or when `tau <= 0`.
* **Example.** `mixtureLogEValueNormal(100, 0.3, 1, 0.5)` is 2.6978748079123354. `mixtureLogEValueNormal(1, 0, 1, 1)` is -0.34657359027997264. `mixtureLogEValueNormal(25, -0.2, 0.5, 0.25)` and `mixtureLogEValueNormal(25, 0.2, 0.5, 0.25)` are both 0.7336371966011912.

### `confidenceSequenceRadiusNormal`

```ts
confidenceSequenceRadiusNormal(n: number, sigma: number, rho: number, alpha: number): number
```

* **Definition.** `sigma * sqrt(2 (n rho^2 + 1) / (n^2 rho^2) * ln(sqrt(n rho^2 + 1) / alpha))`. The parameter `rho` is the prior standard deviation of `mixtureLogEValueNormal` measured in units of `sigma`, so `tau = rho * sigma`. The radius is the value `r` for which `mixtureLogEValueNormal(n, r, sigma, rho * sigma)` equals `ln(1 / alpha)`. The interval from `mean - radius` to `mean + radius` around the running mean holds the true mean at every `n` at once, with probability at least `1 - alpha`.
* **Returns.** A positive number.
* **Throws.** A `RangeError` when `n < 1`, when `sigma <= 0`, when `rho <= 0`, or when `alpha` is outside the open interval (0, 1).
* **Example.** `confidenceSequenceRadiusNormal(1, 1, 1, 0.05)` is 3.6563948713638483. `confidenceSequenceRadiusNormal(50, 2, 1, 0.01)` is 1.0355678374609563. `confidenceSequenceRadiusNormal(10000, 0.3, 0.05, 0.05)` is 0.009304616690482838.

## E-values

An e-value is a non-negative number whose expected value is at most 1 when the null is true. A large e-value is evidence against the null. The functions below take e-values as plain numbers: each one is at least 0 and finite.

### `eValueSimpleVsSimpleBernoulli`

```ts
eValueSimpleVsSimpleBernoulli(successes: number, trials: number, p0: number, p1: number): number
```

* **Definition.** The likelihood ratio itself: `p1^k (1 - p1)^(n - k) / (p0^k (1 - p0)^(n - k))`, with `k = successes` and `n = trials`. It equals `exp` of `sprtLogLikelihoodRatioBernoulli`. When `p0 === p1` the value is 1. A ratio above the largest double is `Infinity` and a ratio below the smallest positive double is 0. Neither case throws.
* **Returns.** A positive number.
* **Throws.** A `RangeError` when `successes > trials`, or when `p0` or `p1` is outside the open interval (0, 1).
* **Example.** `eValueSimpleVsSimpleBernoulli(7, 10, 0.5, 0.7)` is 2.2769316864. `eValueSimpleVsSimpleBernoulli(10, 10, 0.5, 0.9)` is 357.0467226624001. `eValueSimpleVsSimpleBernoulli(1, 6, 0.25, 0.75)` is 0.012345679012345678.

### `eValueBetaMixtureBernoulli`

```ts
eValueBetaMixtureBernoulli(successes: number, trials: number, p0: number, a: number, b: number): number
```

* **Definition.** The marginal likelihood of the data under a Beta(`a`, `b`) prior on the rate, divided by the likelihood under `p0`. With `k = successes` and `n = trials`, the marginal likelihood is `B(a + k, b + n - k) / B(a, b)`. For integer `a` and `b` it is the rational number `(a + k - 1)! (b + n - k - 1)! (a + b - 1)! / ((a - 1)! (b - 1)! (a + b + n - 1)!)`. The result is that number divided by `p0^k (1 - p0)^(n - k)`. For large counts, sum logarithms of factorials and take one `exp` at the end. A result above the largest double is `Infinity` and does not throw.
* **Returns.** A positive number.
* **Throws.** A `RangeError` when `successes > trials`, when `p0` is outside the open interval (0, 1), or when `a` or `b` is not a positive integer.
* **Example.** `eValueBetaMixtureBernoulli(7, 10, 0.5, 1, 1)` is 0.7757575757575758, which is 128 / 165. `eValueBetaMixtureBernoulli(10, 10, 0.5, 1, 1)` is 93.0909090909091. `eValueBetaMixtureBernoulli(12, 12, 0.5, 3, 1)` is 819.2. `eValueBetaMixtureBernoulli(0, 0, 0.5, 1, 1)` is 1.

### `eValueProduct`

```ts
eValueProduct(evalues: number[]): number
```

* **Definition.** The product of the values, taken in array order. The product of e-values from independent stages, or from stages where each is an e-value given the earlier ones, is an e-value. A zero in the array gives 0. A product above the largest double is `Infinity`.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` for an empty array and for a value that is negative, `NaN` or infinite.
* **Example.** `eValueProduct([2, 3, 0.5])` is 3. `eValueProduct([1.3, 0.9, 2.1, 1.7, 0.8])` is 3.3415200000000005. `eValueProduct([1.5, 2.5, 0, 4])` is 0.

### `eValueRunningProduct`

```ts
eValueRunningProduct(evalues: number[]): number[]
```

* **Definition.** The array whose element `k` (counting from 1) is the product of the first `k` values. Element `k` equals `eValueProduct(evalues.slice(0, k))`. Once a value is 0, every later element is 0. The input is not modified.
* **Returns.** An array of numbers with the same length as the input.
* **Throws.** The same `RangeError` conditions as `eValueProduct`.
* **Example.** `eValueRunningProduct([2, 3, 0.5])` is `[2, 6, 3]`. `eValueRunningProduct([1.5, 0, 4, 2])` is `[1.5, 0, 0, 0]`. `eValueRunningProduct([0.25, 8, 0.125, 6])` is `[0.25, 2, 0.25, 1.5]`.

### `eValueAverage`

```ts
eValueAverage(evalues: number[]): number
```

* **Definition.** The arithmetic mean: the sum of the values divided by their count. The mean of e-values is an e-value under any dependence between them.
* **Returns.** A number, at least 0.
* **Throws.** A `RangeError` for an empty array and for a value that is negative, `NaN` or infinite.
* **Example.** `eValueAverage([2, 4])` is 3. `eValueAverage([0, 0, 3])` is 1. `eValueAverage([0.5, 1.5, 2, 10])` is 3.5. `eValueAverage([0.1, 0.2, 0.3, 40])` is 10.15.

### `eValueToPValue`

```ts
eValueToPValue(evalue: number): number
```

* **Definition.** `min(1, 1 / evalue)`. For `evalue = 0` the result is 1. Any `evalue` up to 1 gives 1. The result is a valid p-value.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when `evalue` is negative, `NaN` or infinite.
* **Example.** `eValueToPValue(20)` is 0.05. `eValueToPValue(1000000)` is 0.000001. `eValueToPValue(1.25)` is 0.8. `eValueToPValue(0.5)` is 1. `eValueToPValue(0)` is 1.

### `eBenjaminiHochbergRejections`

```ts
eBenjaminiHochbergRejections(evalues: number[], alpha: number): number
```

* **Definition.** The e-BH procedure for `m` hypotheses, one e-value each, which controls the false discovery rate at `alpha` under any dependence. Sort the e-values from the largest to the smallest and call the `k`-th largest `e(k)`. The result is the largest `k` from 1 to `m` such that `e(k) >= m / (k * alpha)`. The result is 0 when no `k` qualifies. A smaller `k` may fail while a larger `k` passes; the largest passing `k` is the result. The comparison includes equality. Tied values need no rule, because `e(k)` is defined for every `k`. The hypotheses rejected are those with the `k` largest e-values. The function returns only the count. The input is not modified and its order does not matter.
* **Returns.** An integer from 0 to `m`.
* **Throws.** A `RangeError` for an empty array, for a value that is negative, `NaN` or infinite, and when `alpha` is outside the open interval (0, 1).
* **Example.** `eBenjaminiHochbergRejections([5, 4.5, 3, 0.1], 0.5)` is 3: the thresholds are 8, 4, 2.6667 and 2, and `k = 1` fails while `k = 2` and `k = 3` pass. `eBenjaminiHochbergRejections([40, 16, 11, 8, 3, 2, 1, 0], 0.25)` is 4: the thresholds 32, 16 and 8 are met with equality at `k = 1`, `k = 2` and `k = 4`. `eBenjaminiHochbergRejections([10], 0.05)` is 0. `eBenjaminiHochbergRejections([25], 0.05)` is 1.

### `kellyFractionBernoulli`

```ts
kellyFractionBernoulli(p: number, odds: number): number
```

* **Definition.** The fraction `f` of wealth to stake that maximizes the expected log wealth `p ln(1 + odds f) + (1 - p) ln(1 - f)`, where a win pays `odds` times the stake and a loss costs the stake. The result is `max(0, (p (odds + 1) - 1) / odds)`. A result of 0 means no stake: the bet has no edge, which holds when `p * odds <= 1 - p`. The zero is a positive zero.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when `odds <= 0`. A `p` outside [0, 1] throws under the shared conventions.
* **Example.** `kellyFractionBernoulli(0.62, 1.5)` is 0.36666666666666664. `kellyFractionBernoulli(0.4, 2)` is 0.10000000000000003. `kellyFractionBernoulli(0.5, 1)` is 0. `kellyFractionBernoulli(0.3, 1)` is 0. `kellyFractionBernoulli(1, 2)` is 1.

## Spending and boundaries

A group sequential design looks at the data a fixed number of times. The total type I error `alpha` is spent across the looks. The information fraction `t` is the share of the planned information seen so far, from 0 to 1.

### `pocockAlphaSpending`

```ts
pocockAlphaSpending(t: number, alpha: number): number
```

* **Definition.** The cumulative error spent at information fraction `t` is `alpha * ln(1 + (e - 1) t)`, with `e` the base of the natural logarithm. The value is 0 at `t = 0` and `alpha` at `t = 1`, and it increases with `t`. Use `Math.log1p((Math.E - 1) * t)` so that a small `t` keeps its relative accuracy.
* **Returns.** A number in [0, `alpha`].
* **Throws.** A `RangeError` when `t` is outside [0, 1] or when `alpha` is outside the open interval (0, 1).
* **Example.** `pocockAlphaSpending(0.5, 0.05)` is 0.03100572534791388. `pocockAlphaSpending(0.25, 0.025)` is 0.008934350487719714. `pocockAlphaSpending(1e-9, 0.05)` is 8.591409134913997e-11. `pocockAlphaSpending(1, 0.05)` is 0.05. `pocockAlphaSpending(0, 0.05)` is 0.

### `groupSequentialBoundariesObrienFleming`

```ts
groupSequentialBoundariesObrienFleming(looks: number, c: number): number[]
```

* **Definition.** The critical values of an O'Brien-Fleming design with `looks` equally spaced looks. Element `k` (counting from 1) is `c / sqrt(k / looks)`. The constant `c` is the critical value of the last look, which the caller supplies. The values decrease with `k` and the last one is `c`.
* **Returns.** An array of `looks` numbers.
* **Throws.** A `RangeError` when `looks` is not a positive integer (0 throws) or when `c <= 0`.
* **Example.** `groupSequentialBoundariesObrienFleming(4, 2)` is `[4, 2.8284271247461903, 2.309401076758503, 2]`. `groupSequentialBoundariesObrienFleming(3, 2.004)` is `[3.47102981836803, 2.4543887222687446, 2.004]`. `groupSequentialBoundariesObrienFleming(1, 1.96)` is `[1.96]`.
