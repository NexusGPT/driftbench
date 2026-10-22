/** Sample sizes from the normal approximation. */

import { assertFinite } from './basics';

/**
 * The smallest whole number not below the exact value. The value is rounded to 9 decimals first, so that a
 * computation that lands a few units in the last place away from an integer still gives that integer. A value of
 * 1e15 or more is returned as its ceiling without the rounding. The result is at least 1.
 */
function wholeSize(exact: number): number {
  if (exact >= 1e15) return Math.ceil(exact);
  return Math.max(1, Math.ceil(Number(exact.toFixed(9))));
}

function assertPositive(fn: string, name: string, value: number): void {
  assertFinite(fn, name, value);
  if (!(value > 0)) throw new RangeError(`${fn}: ${name} must be above 0, got ${value}`);
}

function assertQuantiles(fn: string, zAlpha: number, zBeta: number): void {
  assertPositive(fn, 'zAlpha', zAlpha);
  assertFinite(fn, 'zBeta', zBeta);
  if (zBeta < 0) throw new RangeError(`${fn}: zBeta must not be negative, got ${zBeta}`);
}

/** The size per arm that detects a difference delta of two means with common standard deviation sd. */
export function sampleSizeTwoMeans(sd: number, delta: number, zAlpha: number, zBeta: number): number {
  const fn = 'sampleSizeTwoMeans';
  assertPositive(fn, 'sd', sd);
  assertFinite(fn, 'delta', delta);
  if (delta === 0) throw new RangeError(`${fn}: delta must not be 0`);
  assertQuantiles(fn, zAlpha, zBeta);
  return wholeSize(2 * (((zAlpha + zBeta) * sd) / delta) ** 2);
}

/** The size per arm that tells two proportions apart, with the pooled proportion under the null. */
export function sampleSizeTwoProportions(p1: number, p2: number, zAlpha: number, zBeta: number): number {
  const fn = 'sampleSizeTwoProportions';
  for (const [name, p] of [
    ['p1', p1],
    ['p2', p2],
  ] as const) {
    assertFinite(fn, name, p);
    if (p < 0 || p > 1) throw new RangeError(`${fn}: ${name} must lie in [0, 1], got ${p}`);
  }
  if (p1 === p2) throw new RangeError(`${fn}: p1 and p2 must differ, got ${p1} twice`);
  assertQuantiles(fn, zAlpha, zBeta);
  const pbar = (p1 + p2) / 2;
  const root = zAlpha * Math.sqrt(2 * pbar * (1 - pbar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return wholeSize(root ** 2 / (p1 - p2) ** 2);
}

/** The size that holds the half width of a normal interval for a proportion p within margin. */
export function sampleSizeProportionMargin(p: number, margin: number, z: number): number {
  const fn = 'sampleSizeProportionMargin';
  assertFinite(fn, 'p', p);
  if (!(p > 0 && p < 1)) throw new RangeError(`${fn}: p must lie strictly between 0 and 1, got ${p}`);
  assertPositive(fn, 'margin', margin);
  assertPositive(fn, 'z', z);
  return wholeSize((z * z * p * (1 - p)) / (margin * margin));
}

/** The size that holds the half width of a normal interval for a mean with standard deviation sd within margin. */
export function sampleSizeMeanMargin(sd: number, margin: number, z: number): number {
  const fn = 'sampleSizeMeanMargin';
  assertPositive(fn, 'sd', sd);
  assertPositive(fn, 'margin', margin);
  assertPositive(fn, 'z', z);
  return wholeSize(((z * sd) / margin) ** 2);
}
