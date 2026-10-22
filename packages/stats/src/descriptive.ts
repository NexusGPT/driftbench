/** Descriptive statistics: the location of a sample. */

import { assertFiniteValues } from './basics';

/**
 * The middle value of the sorted values; with an even count, the mean of the two middle values. The input is
 * not changed.
 */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('median: xs must not be empty');
  assertFiniteValues('median', 'xs', xs);
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  const low = sorted[mid - 1] as number;
  const high = sorted[mid] as number;
  const total = low + high;
  return Number.isFinite(total) ? total / 2 : low / 2 + high / 2;
}
