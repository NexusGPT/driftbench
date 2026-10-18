# Exact tests

This page defines sixteen functions: p-values by enumeration and the statistics of classical tests. The shared rules of [the capabilities page](capabilities.md#conventions) apply to each of them: the `RangeError` rules, the accuracy of a relative 1e-11 and the mid-rank rule for ties.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

| Group | File in `packages/stats/src` | Functions |
|---|---|---|
| Exact tests on counts | `exact.ts` | `fisherExact`, `hypergeometricPmf`, `binomialTestExact`, `signTestExact`, `poissonTestExact` |
| Nonparametric exact tests | `nonparametric.ts` | `wilcoxonSignedRankExactP`, `mannWhitneyUExactP`, `permutationTestMeanDifference`, `waldWolfowitzRunsExactP` |
| Rank statistics | `rank-tests.ts` | `kruskalWallisH`, `friedmanStatistic`, `cochranQ` |
| Statistics of tables | `tables.ts` | `mantelHaenszelOddsRatio`, `chiSquareIndependenceStatistic`, `chiSquareGoodnessOfFitStatistic`, `gTestStatistic` |

## Rules used by several functions

* **Exact value.** A p-value on this page is a sum of probabilities of an exactly defined set of outcomes. The result is that sum, not an approximation by a normal or a chi-square curve. An implementation keeps the relative accuracy of 1e-11 even when the p-value is very small, for example by working with integer counts or with logarithms of probabilities.
* **The small-probabilities rule.** Some two-sided p-values are defined from a discrete distribution with probabilities P(x) and an observed outcome x0. The p-value is the sum of P(x) over every outcome x with P(x) <= P(x0) * (1 + 1e-7). The factor 1 + 1e-7 is a relative slack. It makes outcomes of equal probability count together although their computed probabilities differ in the last digits. The sum is limited to 1. The rule serves `fisherExact`, `binomialTestExact`, `poissonTestExact` and `waldWolfowitzRunsExactP`.
* **The doubled-tail rule.** Some two-sided p-values are defined from a distribution that is symmetric. The p-value is twice the probability of the lower tail that ends at the smaller of the observed statistic and its mirror value, limited to 1. The rule serves `signTestExact`, `wilcoxonSignedRankExactP` and `mannWhitneyUExactP`.
* **Inputs are never changed.** Each function is pure.

## Exact tests on counts

These functions belong in `packages/stats/src/exact.ts`.

### `fisherExact`

```ts
fisherExact(table: { a: number; b: number; c: number; d: number }): number
```

* **Definition.** The table has the cells `a` and `b` in its first row and `c` and `d` in its second row. Let r1 = a + b, c1 = a + c and n = a + b + c + d. The margins are fixed. A table with the same margins has x in its first cell, where x runs over the integers from max(0, r1 + c1 - n) to min(r1, c1). Its probability is P(x) = C(c1, x) * C(n - c1, r1 - x) / C(n, r1), where C is the binomial coefficient. The result is the two-sided p-value by the small-probabilities rule with the observed x0 = a. A table with a zero margin has one possible table, and the result is 1.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when all four cells are 0.
* **Example.** `fisherExact({ a: 3, b: 1, c: 1, d: 3 })` is 0.4857142857142857. `fisherExact({ a: 5, b: 0, c: 0, d: 5 })` is 0.007936507936507936.

### `hypergeometricPmf`

```ts
hypergeometricPmf(k: number, N: number, K: number, n: number): number
```

* **Definition.** A population of N objects holds K marked objects. The function draws n objects without replacement. The result is the probability of exactly k marked objects among them: C(K, k) * C(N - K, n - k) / C(N, n). The result is 0 when k is outside the possible range, that is when k > K, when k > n or when n - k > N - K.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when K > N or when n > N. A k outside the possible range does not throw.
* **Example.** `hypergeometricPmf(2, 10, 4, 5)` is 0.47619047619047616. `hypergeometricPmf(5, 10, 4, 5)` is 0.

### `binomialTestExact`

```ts
binomialTestExact(k: number, n: number, p0: number): number
```

* **Definition.** Under the null hypothesis the count of successes in n trials follows the binomial distribution with success probability p0. Its probability of i successes is P(i) = C(n, i) * p0^i * (1 - p0)^(n - i), where 0^0 is 1. The result is the two-sided p-value by the small-probabilities rule over i = 0, ..., n with the observed x0 = k. The value p0 = 0 and the value p0 = 1 are allowed. For p0 = 0 and k > 0 the observed outcome has probability 0 and the result is 0.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when n is 0 or when k > n.
* **Example.** `binomialTestExact(7, 10, 0.5)` is 0.34375. `binomialTestExact(41, 50, 0.7)` is 0.06531867580464512.

### `signTestExact`

```ts
signTestExact(positives: number, negatives: number): number
```

* **Definition.** Let n = positives + negatives and m = min(positives, negatives). The caller removes the zero differences before the call. Under the null hypothesis each of the n signs is positive with probability 0.5. The result is min(1, 2 * S / 2^n), where S is the sum of C(n, i) for i = 0, ..., m. The result is 1 when positives equals negatives.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when positives + negatives is 0.
* **Example.** `signTestExact(8, 2)` is 0.109375. `signTestExact(0, 6)` is 0.03125.

### `poissonTestExact`

```ts
poissonTestExact(k: number, mean: number): number
```

* **Definition.** Under the null hypothesis the count follows the Poisson distribution with the given mean. Its probability of i events is P(i) = exp(-mean) * mean^i / i!. The result is the two-sided p-value by the small-probabilities rule with the observed x0 = k. The sum runs over the integers i from 0 to L, where L is the largest integer not above k + 10 * sqrt(mean) + 50. The result is the sum up to L, limited to 1. For every allowed input the probabilities beyond L are below 1e-18 of the sum, so the finite sum equals the infinite sum within the accuracy of the page. An implementation evaluates P(i) with the recurrence P(i) = P(i - 1) * mean / i, or with logarithms, so that no factorial overflows. The comparison with the observed probability is made on the same quantities, for example the logarithms.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when mean <= 0, when mean > 20 or when k > 200.
* **Example.** `poissonTestExact(3, 2.5)` is 0.7434843793003163. `poissonTestExact(10, 4.2)` is 0.011126988198972414. `poissonTestExact(2, 3)` is 1, because P(2) and P(3) are equal and both count.

## Nonparametric exact tests

These functions belong in `packages/stats/src/nonparametric.ts`.

### `wilcoxonSignedRankExactP`

```ts
wilcoxonSignedRankExactP(diffs: number[]): number
```

* **Definition.** The differences have no zero and no two equal absolute values. Rank the absolute values from 1 for the smallest to n for the largest. Let W+ be the sum of the ranks of the positive differences, and W- = n(n + 1)/2 - W+. Under the null hypothesis each of the 2^n sign patterns is equally likely, and the statistic T is the sum of the ranks that carry a positive sign. The count of sign patterns with T <= t is found by dynamic programming over the ranks. The result is min(1, 2 * #{patterns with T <= min(W+, W-)} / 2^n), by the doubled-tail rule.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when the array has more than 30 values, when a difference is 0, or when two differences have the same absolute value.
* **Example.** `wilcoxonSignedRankExactP([1.2, 2.3, 0.4, 3.1, 1.8])` is 0.0625. `wilcoxonSignedRankExactP([1.5, -2.5, 3.1, 0.4, -0.9, 2.2, 5.0, -1.1])` is 0.3828125.

### `mannWhitneyUExactP`

```ts
mannWhitneyUExactP(a: number[], b: number[]): number
```

* **Definition.** Let m be the length of `a` and n the length of `b`. No two of the m + n values are equal, inside a group or between the groups. Let U be the number of pairs (x, y), x from `a` and y from `b`, with x > y. Under the null hypothesis each of the C(m + n, m) ways to give m of the m + n ranks to `a` is equally likely. The count of ways for each value of U is found by dynamic programming. The result is min(1, 2 * P(U <= min(U, m * n - U))), by the doubled-tail rule. The result does not change when the two arrays swap.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when an array is empty, when an array has more than 30 values, or when two values of the two arrays together are equal.
* **Example.** `mannWhitneyUExactP([1.1, 2.3, 3.2], [4.5, 5.1, 6.0, 7.2])` is 0.05714285714285714. `mannWhitneyUExactP([1, 4], [2, 3])` is 1.

### `permutationTestMeanDifference`

```ts
permutationTestMeanDifference(a: number[], b: number[]): number
```

* **Definition.** Let m be the length of `a` and n the length of `b`, and let N = m + n. The observed difference is d0 = mean(a) - mean(b). Pool the N values and list every way to choose m of the N positions for the first group. There are C(N, m) such partitions, and equal values at different positions give different partitions. For each partition, d is the mean of the first group minus the mean of the second group. A partition counts when |d| >= |d0| * (1 - 1e-12). The result is the count divided by C(N, m). The result is 1 when d0 is exactly 0, which the function tests on the computed difference itself (a difference of 1e-17 left by rounding is not 0 and goes through the rule above).
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when an array is empty or when C(N, m) is greater than 1,000,000.
* **Example.** `permutationTestMeanDifference([1, 2, 3], [4, 5, 6])` is 0.1. `permutationTestMeanDifference([3.1, 4.2, 5.3], [1.0, 2.0, 2.5, 3.0])` is 0.02857142857142857. `permutationTestMeanDifference([5, 1], [2, 3, 4])` is 1, because both means are 3.

### `waldWolfowitzRunsExactP`

```ts
waldWolfowitzRunsExactP(sequence: number[]): number
```

* **Definition.** The sequence holds only 0 and 1. A run is a maximal block of equal values. Let R be the number of runs, n1 the count of ones, n0 the count of zeros and N = n1 + n0. Under the null hypothesis each arrangement of the ones among the N positions is equally likely. For R = 2k the probability is 2 * C(n1 - 1, k - 1) * C(n0 - 1, k - 1) / C(N, n1). For R = 2k + 1 it is [C(n1 - 1, k - 1) * C(n0 - 1, k) + C(n1 - 1, k) * C(n0 - 1, k - 1)] / C(N, n1). A binomial coefficient C(a, b) is 0 when b < 0 or b > a. The result is the two-sided p-value by the small-probabilities rule over the number of runs, with the observed R.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when the sequence has fewer than 2 values, when it has more than 400 values, when a value is not 0 or 1, or when the sequence has no 0 or no 1.
* **Example.** `waldWolfowitzRunsExactP([0, 0, 0, 1, 1, 1])` is 0.2. `waldWolfowitzRunsExactP([0, 1, 0, 1, 0, 1, 0, 1])` is 0.05714285714285714.

## Rank statistics

These functions belong in `packages/stats/src/rank-tests.ts`. They return the statistic, not a p-value.

### `kruskalWallisH`

```ts
kruskalWallisH(groups: number[][]): number
```

* **Definition.** Pool all N values and rank them from 1 with mid-ranks for ties. Let R_i be the sum of the ranks of group i, and n_i its size. Let H0 = 12 / (N(N + 1)) * sum(R_i^2 / n_i) - 3(N + 1). The tie correction is C = 1 - sum(t^3 - t) / (N^3 - N), where the sum runs over the groups of equal values in the pool and t is the size of such a group. The result is H0 / C. An equal form is (N - 1) * sum(n_i * (mean rank of group i - (N + 1)/2)^2) / sum((rank - (N + 1)/2)^2), where the second sum runs over all N ranks.
* **Returns.** A number, zero or larger.
* **Throws.** A `RangeError` when there are fewer than 2 groups, when a group is empty, or when all N values are equal (C is 0).
* **Example.** `kruskalWallisH([[1, 2, 2], [2, 3, 4], [5, 5, 6, 7]])` is 7.66875. `kruskalWallisH([[1], [2]])` is 1.

### `friedmanStatistic`

```ts
friedmanStatistic(matrix: number[][]): number
```

* **Definition.** The matrix has b rows (blocks) and k columns (treatments). Rank each row from 1 for the smallest value, with mid-ranks for ties. Let R_j be the sum of the ranks of column j. Let Q0 = 12 / (b * k * (k + 1)) * sum(R_j^2) - 3 * b * (k + 1). The tie correction is C = 1 - T / (b * k * (k^2 - 1)), where T is the sum of t^3 - t over all groups of t equal values inside one row. The result is Q0 / C. An equal form is (k - 1) * sum((R_j - b(k + 1)/2)^2) / sum((rank - (k + 1)/2)^2), where the second sum runs over all b * k ranks.
* **Returns.** A number, zero or larger.
* **Throws.** A `RangeError` when the matrix has no row, when a row has fewer than 2 values, when the rows differ in length, or when every row has all its values equal (C is 0).
* **Example.** `friedmanStatistic([[1, 2, 3], [2, 1, 3], [1, 3, 2], [1, 2, 3]])` is 4.5. `friedmanStatistic([[3, 1, 2]])` is 2.

### `cochranQ`

```ts
cochranQ(matrix: number[][]): number
```

* **Definition.** The matrix has b rows (subjects) and k columns (treatments). Each entry is 0 or 1. Let C_j be the sum of column j, R_i the sum of row i and T the sum of all entries. The result is (k - 1) * (k * sum(C_j^2) - T^2) / (k * T - sum(R_i^2)). The value equals the tie-corrected `friedmanStatistic` of the same matrix.
* **Returns.** A number, zero or larger.
* **Throws.** A `RangeError` when the matrix has no row, when a row has fewer than 2 values, when the rows differ in length, when an entry is not 0 or 1, or when the denominator is 0, which happens when every row sum is 0 or k.
* **Example.** `cochranQ([[1, 0, 0], [1, 1, 0], [1, 1, 1], [0, 1, 0], [1, 1, 0], [0, 0, 1]])` is 1.6. `cochranQ([[1, 0, 1]])` is 2.

## Statistics of tables

These functions belong in `packages/stats/src/tables.ts`.

### `mantelHaenszelOddsRatio`

```ts
mantelHaenszelOddsRatio(tables: { a: number; b: number; c: number; d: number }[]): number
```

* **Definition.** Each table has the cells `a`, `b`, `c` and `d`, and n_i = a + b + c + d. The result is sum(a * d / n_i) / sum(b * c / n_i), each sum over all tables. For one table the result is a * d / (b * c). The result is 0 when every product a * d is 0.
* **Returns.** A number, zero or larger.
* **Throws.** A `RangeError` when the list is empty, when a table has all four cells 0, or when sum(b * c / n_i) is 0.
* **Example.** `mantelHaenszelOddsRatio([{ a: 7, b: 3, c: 2, d: 9 }])` is 10.5. `mantelHaenszelOddsRatio([{ a: 12, b: 5, c: 6, d: 14 }, { a: 8, b: 7, c: 3, d: 12 }, { a: 15, b: 4, c: 9, d: 11 }])` is 4.918595711967199.

### `chiSquareIndependenceStatistic`

```ts
chiSquareIndependenceStatistic(counts: number[][]): { statistic: number; df: number }
```

* **Definition.** The matrix has r rows and c columns of counts, and n is the sum of all cells. Let R_i be a row sum and C_j a column sum. The expected count is E_ij = R_i * C_j / n. The statistic is the sum over all cells of (O_ij - E_ij)^2 / E_ij. The sum is formed from these differences, not from the sum of O^2 / E minus n, which cancels when the statistic is small. The degrees of freedom are (r - 1) * (c - 1).
* **Returns.** An object with the fields `statistic` (a number, zero or larger) and `df` (an integer).
* **Throws.** A `RangeError` when there are fewer than 2 rows, when there are fewer than 2 columns, when the rows differ in length, or when a row sum or a column sum is 0.
* **Example.** `chiSquareIndependenceStatistic([[10, 20], [30, 40]])` is `{ statistic: 0.7936507936507936, df: 1 }`. `chiSquareIndependenceStatistic([[20, 15, 10], [10, 25, 30], [5, 12, 40]])` is `{ statistic: 32.03654600010875, df: 4 }`.

### `chiSquareGoodnessOfFitStatistic`

```ts
chiSquareGoodnessOfFitStatistic(observed: number[], expectedProportions: number[]): { statistic: number; df: number }
```

* **Definition.** The observed counts are O_i with n as their sum. Let S be the sum of the proportions p_i. The expected count is E_i = n * p_i / S. The statistic is the sum of (O_i - E_i)^2 / E_i. The degrees of freedom are the number of categories minus 1.
* **Returns.** An object with the fields `statistic` (a number, zero or larger) and `df` (an integer).
* **Throws.** A `RangeError` when there are fewer than 2 categories, when a proportion is 0 or is outside (0, 1], when S differs from 1 by more than 1e-9, or when n is 0.
* **Example.** `chiSquareGoodnessOfFitStatistic([18, 22, 20, 40], [0.25, 0.25, 0.25, 0.25])` is `{ statistic: 12.32, df: 3 }`. `chiSquareGoodnessOfFitStatistic([26, 24], [0.5, 0.5])` is `{ statistic: 0.08, df: 1 }`.

### `gTestStatistic`

```ts
gTestStatistic(observed: number[], expectedProportions: number[]): { statistic: number; df: number }
```

* **Definition.** The expected counts E_i, the degrees of freedom and the inputs are those of `chiSquareGoodnessOfFitStatistic`. The statistic is G = 2 * sum(O_i * ln(O_i / E_i)). A category with O_i = 0 adds 0 to the sum. The sum is formed from the terms O_i * ln(O_i / E_i).
* **Returns.** An object with the fields `statistic` (a number, zero or larger) and `df` (an integer).
* **Throws.** A `RangeError` under the same conditions as `chiSquareGoodnessOfFitStatistic`.
* **Example.** `gTestStatistic([47, 53], [0.4, 0.6])` is `{ statistic: 2.009625115017735, df: 1 }`. `gTestStatistic([0, 12, 8, 0, 5], [0.1, 0.4, 0.3, 0.1, 0.1])` is `{ statistic: 12.339805506855503, df: 4 }`.
