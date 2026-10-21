/** Coverage of value tuples at a strength chosen per group of axes. */

export interface StrengthGroup {
  /** The axes of the group, distinct integers from 0. */
  readonly axes: readonly number[];
  /** How many axes at a time the suite must cover, from 1 to axes.length. */
  readonly strength: number;
}

export interface GroupCoverage {
  readonly covered: number;
  readonly required: number;
  readonly coverage: number;
}

export interface MixedStrengthCoverageResult {
  readonly groups: GroupCoverage[];
  readonly covered: number;
  readonly required: number;
  readonly coverage: number;
}

function subsets(items: readonly number[], size: number): number[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items as [number, ...number[]];
  return [...subsets(rest, size - 1).map((s) => [head, ...s]), ...subsets(rest, size)];
}

/**
 * The share of the value tuples a suite of rows holds. `levels[a]` is the number of values of axis a; a row gives
 * one value index per axis. For each group the required tuples are every choice of `strength` distinct axes of the
 * group with every combination of their values; a tuple is covered when some row holds those values on those axes.
 * The totals add the groups: a tuple asked by two groups counts in each.
 */
export function mixedStrengthCoverage(
  rows: readonly (readonly number[])[],
  groups: readonly StrengthGroup[],
  levels: readonly number[],
): MixedStrengthCoverageResult {
  const fn = 'mixedStrengthCoverage';
  if (groups.length === 0) throw new RangeError(`${fn}: groups must hold at least one group`);
  levels.forEach((l, a) => {
    if (!Number.isSafeInteger(l) || l < 1)
      throw new RangeError(`${fn}: levels[${a}] must be a positive integer, got ${l}`);
  });
  rows.forEach((row, r) => {
    if (row.length !== levels.length)
      throw new RangeError(`${fn}: rows[${r}] has ${row.length} values for ${levels.length} levels`);
    row.forEach((v, a) => {
      if (!Number.isSafeInteger(v) || v < 0 || v >= (levels[a] as number))
        throw new RangeError(`${fn}: rows[${r}][${a}] must be an integer below levels[${a}], got ${v}`);
    });
  });
  groups.forEach((group, g) => {
    const seen = new Set<number>();
    for (const a of group.axes) {
      if (!Number.isSafeInteger(a) || a < 0 || a >= levels.length)
        throw new RangeError(`${fn}: groups[${g}] axis ${a} is outside 0 to ${levels.length - 1}`);
      if (seen.has(a)) throw new RangeError(`${fn}: groups[${g}] repeats axis ${a}`);
      seen.add(a);
    }
    if (!Number.isSafeInteger(group.strength) || group.strength < 1 || group.strength > group.axes.length)
      throw new RangeError(`${fn}: groups[${g}] strength ${group.strength} is outside 1 to its axes`);
  });
  const per = groups.map((group) => {
    let required = 0;
    let covered = 0;
    for (const axes of subsets(
      [...group.axes].sort((x, y) => x - y),
      group.strength,
    )) {
      required += axes.reduce((product, a) => product * (levels[a] as number), 1);
      const held = new Set<string>();
      for (const row of rows) held.add(axes.map((a) => row[a]).join(','));
      covered += held.size;
    }
    return { covered, required, coverage: covered / required };
  });
  const covered = per.reduce((sum, g) => sum + g.covered, 0);
  const required = per.reduce((sum, g) => sum + g.required, 0);
  return { groups: per, covered, required, coverage: covered / required };
}
