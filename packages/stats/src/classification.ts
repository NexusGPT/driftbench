/** Scores of a classifier or a judge from its confusion table: balanced accuracy and the F-beta score. */

import { assertFinite } from './basics';

/** The counts of true positives, false positives, false negatives and true negatives. */
export interface ConfusionTable {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly tn: number;
}

function assertTable(fn: string, table: ConfusionTable): void {
  if (table === null || typeof table !== 'object') {
    throw new RangeError(`${fn}: table must be an object { tp, fp, fn, tn }, got ${table}`);
  }
  for (const field of ['tp', 'fp', 'fn', 'tn'] as const) {
    const value = table[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${fn}: table.${field} must be a non-negative integer, got ${value}`);
    }
  }
}

/**
 * The mean of the true positive rate and the true negative rate: (tp / (tp + fn) + tn / (tn + fp)) / 2.
 * A class with no true case has no rate, so tp + fn = 0 or tn + fp = 0 is refused.
 */
export function balancedAccuracy(table: ConfusionTable): number {
  assertTable('balancedAccuracy', table);
  const positives = table.tp + table.fn;
  const negatives = table.tn + table.fp;
  if (positives === 0)
    throw new RangeError('balancedAccuracy: table has no true positive case (tp + fn is 0)');
  if (negatives === 0)
    throw new RangeError('balancedAccuracy: table has no true negative case (tn + fp is 0)');
  return (table.tp / positives + table.tn / negatives) / 2;
}

/**
 * The weighted harmonic mean of precision and recall, (1 + beta^2) tp / ((1 + beta^2) tp + beta^2 fn + fp).
 * A beta above 1 favours recall, below 1 precision. The result is 0 when the denominator is 0; tn is
 * validated and does not enter the formula.
 */
export function fBeta(table: ConfusionTable, beta: number): number {
  assertTable('fBeta', table);
  assertFinite('fBeta', 'beta', beta);
  if (!(beta > 0)) throw new RangeError(`fBeta: beta must be greater than 0, got ${beta}`);
  const b2 = beta * beta;
  const denominator = (1 + b2) * table.tp + b2 * table.fn + table.fp;
  return denominator === 0 ? 0 : ((1 + b2) * table.tp) / denominator;
}
