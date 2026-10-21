# Many comparisons and combined evidence

A report that compares many criteria, or runs many suites, makes many tests at once. The chance that at least one of them looks significant by luck grows with their number. This page defines the error-rate formulas that control that chance. The conventions of the [shared page](capabilities.md#conventions) apply to every function here.

Words used in the sections:

* **m.** The number of tests.

## Error rates for many tests

The three functions of this section live in `packages/stats/src/rates.ts`. They take the number of tests and a level. All three use the stable forms given, so that a small level keeps its relative accuracy.

### `familywiseErrorRate`
```ts
familywiseErrorRate(m: number, alpha: number): number
```
* **Definition.** The chance of at least one false rejection in `m` independent tests of true nulls, each at level `alpha`: `1 - (1 - alpha)^m`. Compute it as `-expm1(m log1p(-alpha))`. `m` is a non-negative integer and `alpha` is in [0, 1]. The result is 0 when `m` is 0, whatever `alpha` is. It is 1 when `alpha` is 1 and `m` is at least 1.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a non-negative integer, and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `familywiseErrorRate(10, 0.05)` is 0.4012630607616211. `familywiseErrorRate(1, 0.05)` is 0.05. `familywiseErrorRate(0, 0.05)` is 0. `familywiseErrorRate(5, 1)` is 1.

### `bonferroniThreshold`
```ts
bonferroniThreshold(m: number, alpha: number): number
```
* **Definition.** The level for each of `m` tests that keeps the family-wise rate at most `alpha`: `alpha / m`. `m` is a positive integer and `alpha` is in [0, 1].
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a positive integer (0 included), and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `bonferroniThreshold(10, 0.05)` is 0.005. `bonferroniThreshold(4, 1)` is 0.25. `bonferroniThreshold(7, 0)` is 0.

### `sidakThreshold`
```ts
sidakThreshold(m: number, alpha: number): number
```
* **Definition.** The level for each of `m` independent tests that makes the family-wise rate exactly `alpha`: `1 - (1 - alpha)^(1/m)`. Compute it as `-expm1(log1p(-alpha) / m)`. `m` is a positive integer and `alpha` is in [0, 1]. The result is 1 when `alpha` is 1, and 0 when `alpha` is 0. It is never below `bonferroniThreshold(m, alpha)`.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` for an `m` that is not a positive integer (0 included), and for an `alpha` that is NaN, infinite or outside [0, 1].
* **Example.** `sidakThreshold(10, 0.05)` is 0.005116196891823702. `sidakThreshold(1, 0.05)` is 0.05. `sidakThreshold(1000, 0.05)` is 5.129197890901781e-05.
