# Effect sizes

A p-value says that two versions of an agent differ. An effect size says by how much. This page defines eleven functions that measure the size of a difference: a standardised difference of means, a rank based effect size, odds and risk measures of a 2x2 table and three effect sizes for proportions, analysis of variance and goodness of fit. The conventions of every function (invalid input, accuracy, ties, the argument `z`) are in [statistics capabilities](capabilities.md#conventions) and are not repeated here.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

## The 2x2 table

The rates take a table, a plain object `{ a, b, c, d }` of counts.

* Row 1 is the first group. `a` units have the event and `b` do not.
* Row 2 is the second group. `c` units have the event and `d` do not.
* `n1 = a + b` and `n2 = c + d` are the group sizes. `p1 = a / n1` and `p2 = c / n2` are the event rates.

Each count is a non-negative integer, as the shared conventions require. A function that needs more says so in its section.

## Standardised mean differences

The functions of this part belong in `packages/stats/src/effect-size.ts`. Each takes two arrays of numbers. A sample variance divides by n - 1.

### `hedgesG`
```ts
hedgesG(a: number[], b: number[]): number
```
* **Definition.** Cohen's d with the small sample correction `J(df)`, where `df = n1 + n2 - 2`. Let `s1²` and `s2²` be the sample variances of `a` and `b`, with sizes `n1` and `n2`. The pooled variance is `sp² = ((n1 - 1) s1² + (n2 - 1) s2²) / (n1 + n2 - 2)`, and Cohen's d is `d = (mean(a) - mean(b)) / sp`; compute each variance from deviations about its own mean, not from sums of raw squares. The result is `J(df) * d`. The correction is `J(df) = Gamma(df / 2) / (sqrt(df / 2) * Gamma((df - 1) / 2))`. Compute it with the log-gamma function: `J(df) = exp(lnGamma(df / 2) - lnGamma((df - 1) / 2)) / sqrt(df / 2)`. Do not use the approximation `1 - 3 / (4 df - 1)`; it is not exact. `J(df)` is below 1 and tends to 1 as `df` grows.
* **Returns.** A number.
* **Throws.** A `RangeError` when `a` or `b` has fewer than 2 values, and when `sp²` is 0 (every value of both arrays is equal within its array).
* **Example.** `hedgesG([5, 7, 9], [1, 3, 5])` is 1.5957691216057308. Here `df` is 4 and `J(4)` is the square root of 2 / pi. `hedgesG([6, 8], [3, 5, 4])` is 1.8799712059732503 (`df` is 3).

## Rank based effect sizes

The functions of this part belong in `packages/stats/src/effect-size.ts`. Each takes two arrays of numbers, both non-empty. They compare every value of `a` with every value of `b`, so there are `n1 * n2` pairs. Count the pairs as integers first and divide once.

### `varghaDelaneyA`
```ts
varghaDelaneyA(a: number[], b: number[]): number
```
* **Definition.** The probability that a random value of `a` is above a random value of `b`, with ties counting one half. With `gt` the number of pairs with `a[i] > b[j]` and `eq` the number with `a[i] == b[j]`, the result is `(gt + eq / 2) / (n1 * n2)`. The result lies in [0, 1].
* **Returns.** A number.
* **Throws.** No `RangeError` beyond the shared conventions.
* **Example.** `varghaDelaneyA([1, 2, 2, 3], [2, 3, 4])` is 0.20833333333333334. `varghaDelaneyA([2, 2, 2], [2, 2])` is 0.5. `varghaDelaneyA([4, 5, 6], [1, 2, 3])` is 1.

## Rates in a 2x2 table

The functions of this part belong in `packages/stats/src/rates.ts`. Each takes the table `{ a, b, c, d }` described above. Those that return an interval take the normal quantile `z` as a second argument (for a 95 percent interval pass `Z95`). `z` must be finite and greater than 0; a `RangeError` is thrown otherwise.

### `oddsRatio`
```ts
oddsRatio(table: { a: number; b: number; c: number; d: number }): number
```
* **Definition.** `(a * d) / (b * c)`, the odds `a / b` of group 1 divided by the odds `c / d` of group 2.
* **Returns.** A number, 0 or greater. It is 0 when `a` or `d` is 0 and `b * c` is positive.
* **Throws.** A `RangeError` when `b * c` is 0, that is when `b` or `c` is 0.
* **Example.** `oddsRatio({ a: 10, b: 20, c: 5, d: 40 })` is 4. `oddsRatio({ a: 0, b: 7, c: 3, d: 9 })` is 0. `oddsRatio({ a: 3, b: 12, c: 9, d: 6 })` is 0.16666666666666666.

### `logOddsRatioInterval`
```ts
logOddsRatioInterval(table: { a: number; b: number; c: number; d: number }, z: number): { estimate: number; standardError: number; lower: number; upper: number }
```
* **Definition.** The Woolf interval on the log scale. `estimate = ln(a * d / (b * c))`. `standardError = sqrt(1/a + 1/b + 1/c + 1/d)`. `lower = estimate - z * standardError` and `upper = estimate + z * standardError`. All four numbers are on the log scale; take `exp` of `lower` and `upper` for an interval on the odds ratio.
* **Returns.** An object with the fields `estimate`, `standardError`, `lower` and `upper`.
* **Throws.** A `RangeError` when any of the four cells is 0, and when `z` is not greater than 0.
* **Example.** `logOddsRatioInterval({ a: 10, b: 20, c: 5, d: 40 }, Z95)` is `{ estimate: 1.3862943611198906, standardError: 0.6123724356957945, lower: 0.18606644203106315, upper: 2.586522280208718 }`. `logOddsRatioInterval({ a: 1, b: 1, c: 1, d: 1 }, 1)` is `{ estimate: 0, standardError: 2, lower: -2, upper: 2 }`.

### `riskRatio`
```ts
riskRatio(table: { a: number; b: number; c: number; d: number }): number
```
* **Definition.** `p1 / p2`, computed as `a * (c + d) / (c * (a + b))`.
* **Returns.** A number, 0 or greater. It is 0 when `a` is 0.
* **Throws.** A `RangeError` when `a + b` is 0 (group 1 is empty), when `c + d` is 0 (group 2 is empty), and when `c` is 0 (the risk of group 2 is 0).
* **Example.** `riskRatio({ a: 10, b: 20, c: 5, d: 40 })` is 3. `riskRatio({ a: 45, b: 55, c: 30, d: 70 })` is 1.5. `riskRatio({ a: 0, b: 8, c: 3, d: 9 })` is 0.

### `riskRatioInterval`
```ts
riskRatioInterval(table: { a: number; b: number; c: number; d: number }, z: number): { estimate: number; standardError: number; lower: number; upper: number }
```
* **Definition.** The log method. `estimate` is the risk ratio itself. `standardError` is the standard error of `ln(riskRatio)`: `sqrt(b / (a * (a + b)) + d / (c * (c + d)))`. This form equals `sqrt(1/a - 1/(a+b) + 1/c - 1/(c+d))` and does not subtract nearly equal terms. `lower = exp(ln(estimate) - z * standardError)` and `upper = exp(ln(estimate) + z * standardError)`. The bounds are on the ratio scale, not the log scale.
* **Returns.** An object with the fields `estimate`, `standardError`, `lower` and `upper`.
* **Throws.** A `RangeError` when `a` is 0 or `c` is 0 (the logarithm is undefined; this also covers an empty group), and when `z` is not greater than 0.
* **Example.** `riskRatioInterval({ a: 10, b: 20, c: 5, d: 40 }, Z95)` is `{ estimate: 3, standardError: 0.4944132324730442, lower: 1.13835035744767, upper: 7.906177514784792 }`. When `b` and `d` are both 0 the standard error is 0: `riskRatioInterval({ a: 4, b: 0, c: 2, d: 0 }, Z95)` is `{ estimate: 1, standardError: 0, lower: 1, upper: 1 }`.

### `riskDifferenceInterval`
```ts
riskDifferenceInterval(table: { a: number; b: number; c: number; d: number }, z: number): { estimate: number; standardError: number; lower: number; upper: number }
```
* **Definition.** The Wald interval for `p1 - p2`. `estimate = (a * n2 - c * n1) / (n1 * n2)`; form the integer numerator first. `standardError = sqrt(a * b / n1^3 + c * d / n2^3)`, which is `sqrt(p1 (1 - p1) / n1 + p2 (1 - p2) / n2)`. `lower = estimate - z * standardError` and `upper = estimate + z * standardError`. The bounds are not clipped to [-1, 1].
* **Returns.** An object with the fields `estimate`, `standardError`, `lower` and `upper`.
* **Throws.** A `RangeError` when `n1` is 0 or `n2` is 0 (an empty group), and when `z` is not greater than 0.
* **Example.** `riskDifferenceInterval({ a: 10, b: 20, c: 5, d: 40 }, Z95)` is `{ estimate: 0.2222222222222222, standardError: 0.09799078929868854, lower: 0.03016380438013974, upper: 0.4142806400643047 }`. `riskDifferenceInterval({ a: 9, b: 1, c: 1, d: 1 }, 2.5)` has `upper` 1.3151502608861563, above 1.

### `numberNeededToTreat`
```ts
numberNeededToTreat(table: { a: number; b: number; c: number; d: number }): number
```
* **Definition.** `1 / |p1 - p2|`, computed as `n1 * n2 / |a * n2 - c * n1|`. The sign of the difference is dropped, so the result is positive whichever group has the lower risk. The result is not rounded.
* **Returns.** A number, 1 or greater.
* **Throws.** A `RangeError` when `n1` is 0 or `n2` is 0 (an empty group), and when `p1 - p2` is 0 (`a * n2 == c * n1`).
* **Example.** `numberNeededToTreat({ a: 10, b: 20, c: 5, d: 40 })` is 4.5. `numberNeededToTreat({ a: 5, b: 15, c: 10, d: 10 })` is 4. `numberNeededToTreat({ a: 7, b: 0, c: 0, d: 9 })` is 1.

## Proportions, variance explained and goodness of fit

The functions of this part belong in `packages/stats/src/anova.ts`.

### `cohensH`
```ts
cohensH(p1: number, p2: number): number
```
* **Definition.** The difference of the arcsine transforms of two proportions: `h = 2 asin(sqrt(p1)) - 2 asin(sqrt(p2))`. Each term is `phi(p) = 2 asin(sqrt(p))`, which equals `2 atan2(sqrt(p), sqrt(1 - p))`; use that form for an accurate result when `p` is close to 1. `phi(0)` is 0 and `phi(1)` is pi. The result lies in [-pi, pi] and is negative when `p2` is larger.
* **Returns.** A number.
* **Throws.** No `RangeError` beyond the shared conventions: each proportion lies in [0, 1], both ends allowed.
* **Example.** `cohensH(0.5, 0.3)` is 0.41151684606748806. `cohensH(0.9, 0.1)` is 1.8545904360032246. `cohensH(0.25, 0.25)` is 0. `cohensH(1, 0)` is 3.141592653589793. `cohensH(0.6, 0.95)` is -0.9184115942083032.

### `omegaSquared`
```ts
omegaSquared(anova: { ssBetween: number; ssWithin: number; dfBetween: number; dfWithin: number }): number
```
* **Definition.** The share of the variance explained by the groups in a one way analysis of variance, with the bias removed. Let `msWithin = ssWithin / dfWithin` and `ssTotal = ssBetween + ssWithin`. The result is `(ssBetween - dfBetween * msWithin) / (ssTotal + msWithin)`. Equivalent and stable form: `(dfWithin * ssBetween - dfBetween * ssWithin) / (dfWithin * (ssBetween + ssWithin) + ssWithin)`. The result is not clipped at 0: it is negative when the F ratio is below 1.
* **Returns.** A number, below 1.
* **Throws.** A `RangeError` when `ssBetween` is negative, when `ssWithin` is 0 or negative, and when `dfBetween` or `dfWithin` is not an integer of at least 1. A `ssBetween` of 0 is valid.
* **Example.** `omegaSquared({ ssBetween: 12.4, ssWithin: 85.6, dfBetween: 2, dfWithin: 57 })` is 0.09443543268213557. `omegaSquared({ ssBetween: 0, ssWithin: 40, dfBetween: 3, dfWithin: 36 })` is -0.08108108108108109. `omegaSquared({ ssBetween: 9, ssWithin: 3, dfBetween: 2, dfWithin: 3 })` is 0.5384615384615384.

### `cohensW`
```ts
cohensW(observed: number[], expected: number[]): number
```
* **Definition.** The effect size of a chi-square goodness of fit test. `observed` holds the counts of the categories and `expected` the proportions the counts are compared with. Let `n` be the sum of `observed`, `o[i] / n` the observed proportion and `p[i] = expected[i]`. The result is `sqrt(sum over i of (o[i] / n - p[i])^2 / p[i])`, which equals `sqrt(chi2 / n)` with expected counts `n * p[i]`. The proportions are used as given; they are not rescaled. A category with an observed count of 0 is valid.
* **Returns.** A number, 0 or greater. It is 0 when every observed proportion equals its expected proportion.
* **Throws.** A `RangeError` when there are fewer than 2 categories, when `n` is 0, when an expected proportion is 0 or negative, and when the expected proportions do not sum to 1 within an absolute 1e-9.
* **Example.** `cohensW([30, 30, 40], [0.2, 0.3, 0.5])` is 0.264575131106459. `cohensW([25, 25, 25, 25], [0.25, 0.25, 0.25, 0.25])` is 0. `cohensW([10, 0], [0.5, 0.5])` is 1. `cohensW([12, 18, 22, 8, 40], [0.125, 0.25, 0.25, 0.125, 0.25])` is 0.36.
