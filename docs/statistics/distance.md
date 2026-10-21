# Distances and drift

This page defines one function that measures how far two probability vectors are apart. It follows the conventions of [Statistics capabilities to build](capabilities.md): the accuracy, the `RangeError` rules, and the way an array of numbers is checked before any computation.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

The function is pure: the same inputs give the same output, and the inputs are never modified. Numbers are compared as binary64 values, so two values are equal only when they are the same double.

## Divergences between probability vectors

The function of this part is in `packages/stats/src/divergence.ts`.

A probability vector is an array of at least one number, each in [0, 1], whose sum differs from 1 by at most 1e-9. The vector is used as given: no function divides it by its sum. The function takes two probability vectors of the same length (the bins of one histogram, in the same order) and throws a `RangeError` when:

* an array is empty, holds a `NaN` or an infinity, or holds a number outside [0, 1];
* the two arrays differ in length;
* the sum of an array differs from 1 by more than 1e-9.

### `totalVariationDistance`
```ts
totalVariationDistance(p: number[], q: number[]): number
```
* **Definition.** `0.5 * sum(|p[i] - q[i]|)` over all positions: the largest difference in probability that the two vectors give to one event.
* **Returns.** A number between 0 and 1.
* **Throws.** A `RangeError` for an invalid probability vector (see above).
* **Example.** `totalVariationDistance([0.5, 0.5], [0.25, 0.75])` is 0.25. `totalVariationDistance([0.3, 0.7, 0], [0.3, 0.3, 0.4])` is 0.4. `totalVariationDistance([1, 0], [0, 1])` is 1.
* **File.** `packages/stats/src/divergence.ts`.
