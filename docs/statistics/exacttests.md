# Exact tests

This page defines three functions: p-values by enumeration. The shared rules of [the capabilities page](capabilities.md#conventions) apply to each of them: the `RangeError` rules, the accuracy of a relative 1e-11 and the mid-rank rule for ties.

Status: partly built. `hypergeometricPmf`, `signTestExact` and `wilcoxonSignedRankExactP` exist in `@agent-nexus/driftbench-stats`; the other functions are planned.

| Group | File in `packages/stats/src` | Functions |
|---|---|---|
| Exact tests on counts | `exact.ts` | `hypergeometricPmf`, `signTestExact` |
| Nonparametric exact tests | `nonparametric.ts` | `wilcoxonSignedRankExactP` |

## Rules used by several functions

* **Exact value.** A p-value on this page is a sum of probabilities of an exactly defined set of outcomes. The result is that sum, not an approximation by a normal or a chi-square curve. An implementation keeps the relative accuracy of 1e-11 even when the p-value is very small, for example by working with integer counts or with logarithms of probabilities.
* **The doubled-tail rule.** Some two-sided p-values are defined from a distribution that is symmetric. The p-value is twice the probability of the lower tail that ends at the smaller of the observed statistic and its mirror value, limited to 1. The rule serves `signTestExact` and `wilcoxonSignedRankExactP`.
* **Inputs are never changed.** Each function is pure.

## Exact tests on counts

These functions belong in `packages/stats/src/exact.ts`.

### `hypergeometricPmf`

```ts
hypergeometricPmf(k: number, N: number, K: number, n: number): number
```

* **Definition.** A population of N objects holds K marked objects. The function draws n objects without replacement. The result is the probability of exactly k marked objects among them: C(K, k) * C(N - K, n - k) / C(N, n). The result is 0 when k is outside the possible range, that is when k > K, when k > n or when n - k > N - K.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when K > N or when n > N. A k outside the possible range does not throw.
* **Example.** `hypergeometricPmf(2, 10, 4, 5)` is 0.47619047619047616. `hypergeometricPmf(5, 10, 4, 5)` is 0.

### `signTestExact`

```ts
signTestExact(positives: number, negatives: number): number
```

* **Definition.** Let n = positives + negatives and m = min(positives, negatives). The caller removes the zero differences before the call. Under the null hypothesis each of the n signs is positive with probability 0.5. The result is min(1, 2 * S / 2^n), where S is the sum of C(n, i) for i = 0, ..., m. The result is 1 when positives equals negatives.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when positives + negatives is 0.
* **Example.** `signTestExact(8, 2)` is 0.109375. `signTestExact(0, 6)` is 0.03125.

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
