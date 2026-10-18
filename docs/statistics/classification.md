# Classification, calibration and agreement

This page defines the scores of a classifier or a judge, the calibration of its probabilities, and the agreement between raters. Each section gives the formula, the result and the inputs it refuses. The conventions of [statistics capabilities](capabilities.md) hold for every function: the `RangeError` rules, the accuracy, the mid-ranks, and the quantile `z` passed as an argument.

Status: planned. None of these functions exists in `@agent-nexus/driftbench-stats` yet.

Three terms recur.

* **Outcome.** The true result of one case, the number 0 or 1. A value other than 0 or 1 is a `RangeError` wherever a function takes outcomes or labels of that kind.
* **Confusion table.** A plain object `{ tp, fp, fn, tn }`: the counts of true positives, false positives, false negatives and true negatives. The four fields are required. Each is a non-negative integer. Other fields are ignored.
* **Category label.** An integer that names the category a rater chose. Two labels are the same category when they are equal numbers.

## Calibration

These functions belong in `packages/stats/src/calibration.ts`. They take a probability for each case and the outcome of that case, in two arrays of the same length.

### `brierScore`
```ts
brierScore(probabilities: number[], outcomes: number[]): number
```
* **Definition.** The mean squared difference between probability and outcome: the sum over cases of `(p_i - o_i)^2`, divided by `n`. The score is 0 for a perfect forecast and 1 for the worst forecast.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when an outcome is not 0 or 1.
* **Example.** `brierScore([0.5], [1])` is 0.25. `brierScore([0.9, 0.8, 0.3, 0.6, 0.1, 0.75, 0.4, 0.95], [1, 1, 0, 1, 0, 0, 1, 1])` is 0.154375. `brierScore([1, 0, 1, 0], [0, 1, 1, 0])` is 0.5.

### `logLoss`
```ts
logLoss(probabilities: number[], outcomes: number[]): number
```
* **Definition.** Minus the mean of the natural logarithm of the probability that the forecast gave to the outcome that happened. For each case that probability is `p_i` when the outcome is 1 and `1 - p_i` when it is 0. The result is `-(1/n)` times the sum over cases of `o_i ln(p_i) + (1 - o_i) ln(1 - p_i)`.
* **Returns.** A number, 0 or greater.
* **Throws.** A `RangeError` when a probability is 0 or 1 (the probability must lie strictly between 0 and 1), and when an outcome is not 0 or 1.
* **Example.** `logLoss([0.5], [1])` is 0.6931471805599453, the natural logarithm of 2. `logLoss([0.25], [0])` is 0.2876820724517809. `logLoss([0.01, 0.99], [0, 0])` is 2.307610260920796.

### `expectedCalibrationError`
```ts
expectedCalibrationError(probabilities: number[], outcomes: number[], bins: number): number
```
* **Definition.** The range [0, 1] is cut into `bins` intervals of equal width. Bin `b` (counting from 0) holds the probabilities from `b / bins` up to but not including `(b + 1) / bins`. The last bin also holds the probability 1. The bin of a probability `p` is `Math.min(Math.floor(p * bins), bins - 1)`, with the product taken in binary64. A probability on a bin edge in exact arithmetic but not in binary64 (0.3 with 10 bins) follows the binary64 product. For each bin that holds at least one case, take the absolute difference between the mean outcome and the mean probability of its cases, and weight it by the share of all cases in the bin. The result is the sum of the weighted differences. Empty bins add nothing.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when an outcome is not 0 or 1, and when `bins` is less than 1.
* **Example.** With `bins` = 4, `expectedCalibrationError([1, 0, 0.25, 0.5, 0.75, 0.125, 0.875, 1], [1, 0, 0, 1, 1, 0, 1, 0], 4)` is 0.1875. With `bins` = 1 the result is the absolute difference between the mean outcome and the mean probability: `expectedCalibrationError([0.9, 0.8, 0.3, 0.6, 0.1, 0.75, 0.4, 0.95], [1, 1, 0, 1, 0, 0, 1, 1], 1)` is 0.025. `expectedCalibrationError([0.8], [0], 3)` is 0.8.

### `maximumCalibrationError`
```ts
maximumCalibrationError(probabilities: number[], outcomes: number[], bins: number): number
```
* **Definition.** The binning is the one of `expectedCalibrationError`. The result is the largest, over the bins that hold at least one case, of the absolute difference between the mean outcome and the mean probability of the bin. Empty bins are skipped.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when an outcome is not 0 or 1, and when `bins` is less than 1.
* **Example.** `maximumCalibrationError([1, 0, 0.25, 0.5, 0.75, 0.125, 0.875, 1], [1, 0, 0, 1, 1, 0, 1, 0], 4)` is 0.5. `maximumCalibrationError([0.31, 0.38, 0.33, 0.82, 0.85, 0.89], [0, 1, 0, 1, 1, 1], 10)` is 0.1466666666666667. With one bin it equals `expectedCalibrationError`: 0.025 for the eight forecasts of the `expectedCalibrationError` example with one bin.

## Ranking and confusion table

These functions belong in `packages/stats/src/classification.ts`.

### `aucRoc`
```ts
aucRoc(scores: number[], labels: number[]): number
```
* **Definition.** The area under the ROC curve, as the probability that a randomly chosen positive case scores higher than a randomly chosen negative case, with a tie counting one half. Let `P` be the number of cases with label 1 and `N` the number with label 0. The result is the sum, over all `P * N` pairs of one positive and one negative, of 1 when the positive score is greater, 0.5 when the scores are equal and 0 when the positive score is smaller, divided by `P * N`. The scores are any finite numbers; they need not be probabilities. Only their order matters.
* **Returns.** A number in [0, 1].
* **Throws.** A `RangeError` when a label is not 0 or 1, and when `P` is 0 or `N` is 0.
* **Example.** `aucRoc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])` is 0.75. `aucRoc([0.2, 0.2, 0.2, 0.2], [1, 0, 1, 0])` is 0.5, because every pair is a tie. `aucRoc([4, 1, 3, 2, 5], [1, 0, 0, 1, 1])` is 0.8333333333333334.

### `averagePrecision`
```ts
averagePrecision(scores: number[], labels: number[]): number
```
* **Definition.** Sort the cases by decreasing score. Cases with equal scores form one block. For a block, let `k` be the number of cases whose score is greater than or equal to the score of the block, and `TP` the number of positives among those `k` cases. The precision of the block is `TP / k`. Every positive case in the block takes that precision. The result is the sum of the precisions of all positive cases, divided by `P`, the number of positives. A positive case therefore counts `TP / k` where `k` and `TP` are taken over all cases that score at least as high as it, ties included. The order of the input does not matter.
* **Returns.** A number in (0, 1].
* **Throws.** A `RangeError` when a label is not 0 or 1, and when there is no positive case.
* **Example.** `averagePrecision([0.9, 0.8, 0.7, 0.6], [1, 0, 1, 0])` is 0.8333333333333334, the mean of 1 and 2/3. `averagePrecision([0.5, 0.5, 0.5, 0.2], [1, 0, 1, 0])` is 0.6666666666666666, because the first three cases form one block with precision 2/3. `averagePrecision([0.4, 0.4, 0.4, 0.4, 0.4], [1, 0, 0, 0, 0])` is 0.2.

### `matthewsCorrelation`
```ts
matthewsCorrelation(table: { tp: number; fp: number; fn: number; tn: number }): number
```
* **Definition.** The correlation between the predicted and the true class: `(tp * tn - fp * fn) / sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))`. When the denominator is 0 (a factor under the root is 0), the result is 0. This includes the table with four zeros.
* **Returns.** A number in [-1, 1].
* **Throws.** A `RangeError` when a field of the table is missing or is not a non-negative integer.
* **Example.** `matthewsCorrelation({ tp: 40, fp: 10, fn: 5, tn: 45 })` is 0.7035264706814485. `matthewsCorrelation({ tp: 5, fp: 0, fn: 0, tn: 5 })` is 1. `matthewsCorrelation({ tp: 0, fp: 0, fn: 3, tn: 7 })` is 0, because no case is predicted positive. `matthewsCorrelation({ tp: 12, fp: 7, fn: 9, tn: 4 })` is -0.06279669574154818.

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

### `percentAgreement`
```ts
percentAgreement(a: number[], b: number[]): number
```
* **Definition.** The share of positions at which the two arrays hold the same value, as a percentage: `100 * m / n`, where `m` is the number of positions `i` with `a[i] === b[i]` and `n` is the length. The values may be any finite numbers.
* **Returns.** A number in [0, 100]. It is a percentage, not a proportion.
* **Throws.** Nothing beyond the shared conventions (empty arrays, arrays of different length, a value that is not finite).
* **Example.** `percentAgreement([1, 2, 3, 1], [1, 2, 2, 1])` is 75. `percentAgreement([1, 1, 2], [2, 2, 1])` is 0. `percentAgreement([0, 1, 2, 1, 0, 2, 1, 1, 0], [0, 1, 1, 1, 0, 2, 2, 1, 0])` is 77.77777777777777.

## Agreement

These functions belong in `packages/stats/src/agreement.ts`.

### `weightedKappa`
```ts
weightedKappa(table: number[][], weights: 'linear' | 'quadratic'): number
```
* **Definition.** The table has one row and one column per ordered category. Cell `table[i][j]` is the number of subjects that rater A put in category `i` and rater B put in category `j`. Let `n` be the sum of all cells, `r_i` the sum of row `i` and `c_j` the sum of column `j`. The disagreement weight of a pair of categories is `w_ij = |i - j|` for `'linear'` and `w_ij = (i - j)^2` for `'quadratic'`. The weights are not rescaled. The observed disagreement is `D_o = sum(w_ij * table[i][j]) / n`. The expected disagreement is `D_e = sum(w_ij * r_i * c_j) / n^2`. The result is `1 - D_o / D_e`. When `D_e` is 0 the result is 1. This happens when both raters use one and the same single category for every subject, and for a table with one cell.
* **Returns.** A number, at most 1.
* **Throws.** A `RangeError` when `weights` is not the string `'linear'` or the string `'quadratic'`, when the table has no row, when it is not square (a row whose length differs from the number of rows), and when `n` is 0.
* **Example.** `weightedKappa([[20, 5], [10, 15]], 'linear')` is 0.4, the same as with `'quadratic'` (on two categories both weightings give the unweighted kappa). For `[[11, 3, 1], [2, 9, 4], [0, 3, 12]]`, `'linear'` gives 0.65 and `'quadratic'` gives 0.7333333333333333. `weightedKappa([[0, 5], [5, 0]], 'linear')` is -1. `weightedKappa([[7]], 'linear')` is 1.

### `scottPi`
```ts
scottPi(a: number[], b: number[]): number
```
* **Definition.** Two raters label the same `n` subjects; `a[i]` and `b[i]` are the labels of subject `i`. Let `po` be the share of subjects with `a[i] === b[i]`. For each label `c` that occurs in `a` or in `b`, let `pi_c` be the number of times `c` occurs in the two arrays together, divided by `2n`. The chance agreement is `pe = sum(pi_c^2)` over those labels. The result is `(po - pe) / (1 - pe)`. When `pe` is 1 (every label in both arrays is the same single value) the result is 1.
* **Returns.** A number, at most 1.
* **Throws.** A `RangeError` when a label is not an integer.
* **Example.** `scottPi([0, 0, 1, 1], [1, 1, 0, 0])` is -1. `scottPi([1, 1, 2, 2, 3, 3, 1, 2], [1, 2, 2, 2, 3, 1, 1, 2])` is 0.6049382716049383. `scottPi([5, 5, 5, 5], [5, 5, 5, 5])` is 1. With 18 subjects both raters label 1, one subject is labelled 2 by A only, and one is labelled 2 by B only, the result is -0.05263157894736842.

### `gwetAc1`
```ts
gwetAc1(a: number[], b: number[]): number
```
* **Definition.** Two raters, nominal labels. Let `po` and `pi_c` be defined as for `scottPi`, and let `q` be the number of distinct labels that occur in `a` or in `b`. When `q` is 1 the result is 1. Otherwise the chance agreement is `pe = sum(pi_c * (1 - pi_c)) / (q - 1)`, which equals `(1 - sum(pi_c^2)) / (q - 1)`. For `q` = 2 this is `2 * pi * (1 - pi)` with `pi` the pooled share of either label. The result is `(po - pe) / (1 - pe)`. For `q` of 2 or more, `pe` is at most `1 / q`, so the denominator is positive.
* **Returns.** A number, at most 1.
* **Throws.** A `RangeError` when a label is not an integer.
* **Example.** `gwetAc1([0, 0, 1, 1], [1, 1, 0, 0])` is -1. `gwetAc1([1, 1, 2, 2, 3, 3, 1, 2], [1, 2, 2, 2, 3, 1, 1, 2])` is 0.6342857142857142. For the skewed example of `scottPi` (18 shared labels 1, then one 2 from each rater at different subjects), the result is 0.8895027624309392, where `scottPi` gives -0.05263157894736842.

### `fleissKappa`
```ts
fleissKappa(matrix: number[][]): number
```
* **Definition.** Each row is a subject, each column a category, and `matrix[i][j]` is the number of raters who put subject `i` in category `j`. Every row has the same sum `n`, the number of raters, and `n` is at least 2. Let `N` be the number of rows. The agreement of a subject is `P_i = (sum_j matrix[i][j]^2 - n) / (n * (n - 1))`, the share of pairs of distinct raters that agree. `Pbar` is the mean of the `P_i`. The share of category `j` is `p_j = sum_i matrix[i][j] / (N * n)`, and `Pe = sum(p_j^2)`. The result is `(Pbar - Pe) / (1 - Pe)`. When `Pe` is 1 (all ratings fall in one category, which includes a matrix with one column) the result is 1.
* **Returns.** A number, at most 1.
* **Throws.** A `RangeError` when the matrix has no row, when a row is empty, when rows have different lengths, when the row sums differ, and when the common row sum is less than 2.
* **Example.** The matrix of ten subjects rated by 14 raters into 5 categories, `[[0, 0, 0, 0, 14], [0, 2, 6, 4, 2], [0, 0, 3, 5, 6], [0, 3, 9, 2, 0], [2, 2, 8, 1, 1], [7, 7, 0, 0, 0], [3, 2, 6, 3, 0], [2, 5, 3, 2, 2], [6, 5, 2, 1, 0], [0, 2, 2, 3, 7]]`, gives 0.20993070442195524. `fleissKappa([[3, 0], [0, 3], [3, 0]])` is 1. `fleissKappa([[2, 0], [1, 1], [0, 2], [2, 0]])` is 0.4666666666666667. `fleissKappa([[2, 2], [2, 2], [2, 2]])` is -0.3333333333333333.

### `linsConcordance`
```ts
linsConcordance(x: number[], y: number[]): number
```
* **Definition.** Lin's concordance correlation coefficient between two measurements of the same cases: `2 * s_xy / (s_x2 + s_y2 + (mean_x - mean_y)^2)`. Here `s_xy` is the population covariance (division by `n`), and `s_x2` and `s_y2` are the population variances (division by `n`). Compute the deviations from the means first, then the sums of products; do not subtract a mean of squares from a square of means.
* **Returns.** A number in [-1, 1].
* **Throws.** A `RangeError` when the denominator is 0, which happens when all values of `x` and of `y` are one and the same number.
* **Example.** `linsConcordance([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])` is 1. `linsConcordance([1, 2, 3, 4, 5], [2, 3, 4, 5, 6])` is 0.8, because the shift of 1 lowers the agreement. `linsConcordance([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])` is -1. `linsConcordance([1], [2])` is 0. `linsConcordance([1, 2, 3, 4, 5], [1.1, 2.1, 2.9, 4.2, 4.8])` is 0.9942438513867086.

### `blandAltmanLimits`
```ts
blandAltmanLimits(x: number[], y: number[], z: number): { bias: number; lower: number; upper: number }
```
* **Definition.** Let `d_i = x_i - y_i`. The `bias` is the mean of the differences. The sample standard deviation `s` of the differences divides by `n - 1` and is computed from the deviations from the mean. The limits of agreement are `lower = bias - z * s` and `upper = bias + z * s`. The caller passes `z`; for 95 percent limits it is `Z95`.
* **Returns.** An object with the three numbers `bias`, `lower` and `upper`.
* **Throws.** A `RangeError` when there are fewer than 2 pairs, and when `z` is not greater than 0.
* **Example.** With `x = [10.2, 11.5, 9.8, 12.1, 10.9]`, `y = [10.0, 11.9, 9.5, 12.4, 10.2]` and `z = Z95`, the result is `{ bias: 0.1, lower: -0.7874114368444312, upper: 0.9874114368444312 }`. With `x = [1.5, 2.5, 3.5]` and `y = [1, 2, 3]` every difference is 0.5, so the result is `{ bias: 0.5, lower: 0.5, upper: 0.5 }`. With `x` equal to `y` it is `{ bias: 0, lower: 0, upper: 0 }`.
