# Classification and agreement

This page defines the scores of a classifier or a judge and the agreement between raters. Each section gives the formula, the result and the inputs it refuses. The conventions of [statistics capabilities](capabilities.md) hold for every function: the `RangeError` rules and the accuracy.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

Two terms recur.

* **Confusion table.** A plain object `{ tp, fp, fn, tn }`: the counts of true positives, false positives, false negatives and true negatives. The four fields are required. Each is a non-negative integer. Other fields are ignored.
* **Category label.** An integer that names the category a rater chose. Two labels are the same category when they are equal numbers.

## Confusion table

These functions belong in `packages/stats/src/classification.ts`.

### `balancedAccuracy`
```ts
balancedAccuracy(table: { tp: number; fp: number; fn: number; tn: number }): number
```
* **Definition.** The mean of the true positive rate and the true negative rate: `(tp / (tp + fn) + tn / (tn + fp)) / 2`.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when a field is missing or is not a non-negative integer, and when `tp + fn` is 0 or `tn + fp` is 0 (a class with no true case has no rate).
* **Example.** `balancedAccuracy({ tp: 40, fp: 10, fn: 5, tn: 45 })` is 0.8535353535353535. `balancedAccuracy({ tp: 1, fp: 0, fn: 9, tn: 90 })` is 0.55. `balancedAccuracy({ tp: 0, fp: 5, fn: 5, tn: 0 })` is 0.

### `fBeta`
```ts
fBeta(table: { tp: number; fp: number; fn: number; tn: number }, beta: number): number
```
* **Definition.** The weighted harmonic mean of precision and recall, in the form `(1 + beta^2) * tp / ((1 + beta^2) * tp + beta^2 * fn + fp)`. A `beta` above 1 favours recall; a `beta` below 1 favours precision. When the denominator is 0 the result is 0. The field `tn` is validated but does not enter the formula.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when a field is missing or is not a non-negative integer, and when `beta` is not greater than 0.
* **Example.** For the table `{ tp: 40, fp: 10, fn: 5, tn: 45 }`, `fBeta(table, 1)` is 0.8421052631578947, `fBeta(table, 2)` is 0.8695652173913043 and `fBeta(table, 0.5)` is 0.8163265306122449. `fBeta({ tp: 0, fp: 0, fn: 0, tn: 9 }, 1)` is 0.

## Agreement

These functions belong in `packages/stats/src/agreement.ts`.

### `gwetAc1`
```ts
gwetAc1(a: number[], b: number[]): number
```
* **Definition.** Two raters label the same `n` subjects; `a[i]` and `b[i]` are the labels of subject `i`. Let `po` be the share of subjects with `a[i] === b[i]`. For each label `c` that occurs in `a` or in `b`, let `pi_c` be the number of times `c` occurs in the two arrays together, divided by `2n`. Let `q` be the number of distinct labels that occur in `a` or in `b`. When `q` is 1 the result is 1. Otherwise the chance agreement is `pe = sum(pi_c * (1 - pi_c)) / (q - 1)`, which equals `(1 - sum(pi_c^2)) / (q - 1)`. For `q` = 2 this is `2 * pi * (1 - pi)` with `pi` the pooled share of either label. The result is `(po - pe) / (1 - pe)`. For `q` of 2 or more, `pe` is at most `1 / q`, so the denominator is positive.
* **Returns.** A number, at most 1.
* **Throws.** A `RangeError` when a label is not an integer.
* **Example.** `gwetAc1([0, 0, 1, 1], [1, 1, 0, 0])` is -1. `gwetAc1([1, 1, 2, 2, 3, 3, 1, 2], [1, 2, 2, 2, 3, 1, 1, 2])` is 0.6342857142857142. With 18 subjects both raters label 1, one subject labelled 2 by A only, and one labelled 2 by B only, the result is 0.8895027624309392.
