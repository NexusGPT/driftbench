/**
 * Repeat reducers: how one criterion's verdicts across the repeats of one spec become one verdict.
 *
 * Each repeat is a number: 1 for a pass, 0 for a fail, and undefined for an inconclusive repeat, which is
 * left out of every reducer. A reducer that cannot decide returns undefined, never a pass or a fail.
 */

export type RepeatReducer = { kind: 'mode' } | { kind: 'median' } | { kind: 'at_least'; k: number };

const SPELLING = /^(mode|median|at_least:([1-9][0-9]*))$/;

/** Reads `mode`, `median` or `at_least:<k>`. Anything else is refused. */
export function parseRepeatReducer(spelling: string): RepeatReducer {
  const match = SPELLING.exec(spelling);
  if (!match) throw new RangeError(`repeat reducer must be mode, median or at_least:<k>, got ${spelling}`);
  if (spelling === 'mode') return { kind: 'mode' };
  if (spelling === 'median') return { kind: 'median' };
  return { kind: 'at_least', k: Number(match[2]) };
}

/**
 * Reduces the repeats to 1 (pass), 0 (fail) or undefined (undecided).
 *
 * mode: the most common scored value, when more than half of the repeats are scored; a tie goes to the value seen first.
 * median: above one half passes, below it fails, exactly one half is undecided.
 * at_least k: passes when at least k repeats pass; fails only when the passes plus the unscored repeats cannot reach k;
 * undecided otherwise, since an unscored repeat could still be the k-th pass.
 */
export function reduceRepeats(
  values: readonly (number | undefined)[],
  reducer: RepeatReducer,
): 0 | 1 | undefined {
  const scored = values.filter((value): value is number => value !== undefined);
  if (reducer.kind === 'mode') {
    // More than half of the repeats must be scored: one verdict from one repeat of three is not a verdict on the criterion.
    if (scored.length * 2 <= values.length) return undefined;
    const counts = new Map<number, number>();
    for (const value of scored) counts.set(value, (counts.get(value) ?? 0) + 1);
    let best: number | undefined;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best === 1 ? 1 : 0;
  }
  if (reducer.kind === 'median') {
    if (scored.length === 0) return undefined;
    const sorted = [...scored].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median =
      sorted.length % 2 === 1
        ? (sorted[Math.floor(mid)] ?? 0)
        : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    if (median > 0.5) return 1;
    if (median < 0.5) return 0;
    return undefined;
  }
  const passes = scored.filter((value) => value === 1).length;
  const unscored = values.length - scored.length;
  if (passes >= reducer.k) return 1;
  if (passes + unscored < reducer.k) return 0;
  return undefined;
}
