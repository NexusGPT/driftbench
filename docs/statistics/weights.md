# Mixture weights and mixed-strength coverage

This page defines two functions of `@agent-nexus/driftbench-stats`. The conventions of [statistics capabilities](capabilities.md) hold: the `RangeError` rules and the accuracy.

Status: built.

## `mixtureWeights`

```ts
mixtureWeights(
  components: number[][],
  counts: number[],
  options?: { tolerance?: number; maxIterations?: number },
): { weights: number[]; iterations: number; logLikelihood: number }
```

* **Definition.** `components` holds m probability vectors over the same c categories (entries in [0, 1], each row summing to 1 within 1e-12). `counts` holds c counts. The weights are the m non-negative mixture weights, summing to 1, that maximise the multinomial log-likelihood `sum_i counts_i log(sum_j w_j components_j_i)`. They are found by expectation-maximisation from equal weights, until no weight moves more than `tolerance` (default 1e-12) or `maxIterations` (default 100000) is reached. When the observed shares are a mix of linearly independent components, the result is that mix. A category with count 0 that no component reaches takes no part.
* **Returns.** `weights`, the number of `iterations`, and the `logLikelihood` at the returned weights.
* **Throws.** A `RangeError` that starts with `mixtureWeights` and names the argument, for: no component; a component of another length than `counts`; an entry outside [0, 1]; a row not summing to 1; a count that is not a non-negative integer; counts that are all 0; a positive count in a category no component can produce.
* **File.** `packages/stats/src/mixture.ts`.

## `mixedStrengthCoverage`

```ts
mixedStrengthCoverage(
  rows: number[][],
  groups: { axes: number[]; strength: number }[],
  levels: number[],
): { groups: { covered: number; required: number; coverage: number }[]; covered: number; required: number; coverage: number }
```

* **Definition.** `levels[a]` is the number of values of axis a; a row gives one value index per axis, from 0. For a group, the required tuples are every choice of `strength` distinct axes of the group with every combination of their values. A tuple is covered when some row holds those values on those axes. `coverage` is covered over required. The totals add the groups: a tuple asked by two groups counts in each.
* **Returns.** The count per group and the totals.
* **Throws.** A `RangeError` that starts with `mixedStrengthCoverage` and names the argument (`rows`, `groups` or `levels`), for: no group; a row of another length than `levels`; a value that is not an integer in [0, levels[a] - 1]; a level count that is not a positive integer; an axis out of range, fractional or repeated in a group; a strength below 1 or above the group's axis count.
* **File.** `packages/stats/src/mixed-strength.ts`.
