import type { Spec } from '@driftbench/core';
import { combinations, placeSpec } from '@driftbench/space';
import type { PreparedMap } from '../seed/map';
import { allowedTuples, tupleKey } from '../seed/twise';

/**
 * t-wise coverage of a set of specs on the approved map, every dimension included, without enumerating
 * the full grid. Each spec is placed with `placeSpec` from `@driftbench/space` (the same placement rules
 * as `driftbench space coverage`); a t-tuple is allowed when an allowed full cell holds it (the same
 * definition), decided by search instead of enumeration, so a map whose grid is far over the space
 * package's 250000-cell limit is still measured.
 */
export type MeasuredCoverage = {
  t: number;
  specs: number;
  /** Allowed t-tuples over every dimension of the map. */
  allowed: number;
  covered: number;
  share: number;
};

export type AllowedSet = { t: number; keys: ReadonlySet<string> };

export function allowedSet(prepared: PreparedMap, t: number): AllowedSet {
  const sizes = prepared.space.dimensions.map((dimension) => dimension.values.length);
  const dimensions = sizes.map((_, index) => index);
  const tuples = allowedTuples(prepared.feasibility, sizes, dimensions, t);
  return { t, keys: new Set(tuples.map((tuple) => tupleKey(tuple.dimensions, tuple.values))) };
}

export function measureCoverage(
  prepared: PreparedMap,
  specs: readonly Spec[],
  allowed: AllowedSet,
): MeasuredCoverage {
  const width = prepared.space.dimensions.length;
  const subsets = combinations(width, allowed.t);
  const covered = new Set<string>();
  for (const spec of specs) {
    const placement = placeSpec(prepared.space, spec);
    for (const event of placement.events) {
      for (const subset of subsets) {
        const lists = subset.map((dimension) => event.values[dimension] ?? []);
        if (lists.some((list) => list.length === 0)) continue;
        for (const values of product(lists)) {
          const key = tupleKey(subset, values);
          if (allowed.keys.has(key)) covered.add(key);
        }
      }
    }
  }
  const total = allowed.keys.size;
  return {
    t: allowed.t,
    specs: specs.length,
    allowed: total,
    covered: covered.size,
    share: total === 0 ? 0 : covered.size / total,
  };
}

function product(lists: number[][]): number[][] {
  let out: number[][] = [[]];
  for (const list of lists) out = out.flatMap((prefix) => list.map((value) => [...prefix, value]));
  return out;
}
