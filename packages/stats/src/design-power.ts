/** Power arithmetic for a comparison of two means. */

import { assertFinite } from './basics';

/**
 * The smallest difference between two means that a test with nPerArm units per arm detects, at the level given
 * by zAlpha and the power given by zBeta: (zAlpha + zBeta) * sd * sqrt(2 / nPerArm).
 */
export function minimumDetectableMeanDifference(
  sd: number,
  nPerArm: number,
  zAlpha: number,
  zBeta: number,
): number {
  const fn = 'minimumDetectableMeanDifference';
  assertFinite(fn, 'sd', sd);
  assertFinite(fn, 'zAlpha', zAlpha);
  assertFinite(fn, 'zBeta', zBeta);
  if (!(sd > 0)) throw new RangeError(`${fn}: sd must be above 0, got ${sd}`);
  if (!Number.isSafeInteger(nPerArm) || nPerArm < 1)
    throw new RangeError(`${fn}: nPerArm must be a positive integer, got ${nPerArm}`);
  if (!(zAlpha > 0)) throw new RangeError(`${fn}: zAlpha must be above 0, got ${zAlpha}`);
  if (zBeta < 0) throw new RangeError(`${fn}: zBeta must not be negative, got ${zBeta}`);
  return (zAlpha + zBeta) * sd * Math.sqrt(2 / nPerArm);
}
