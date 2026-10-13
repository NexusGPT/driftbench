import { type Rng, range, shuffle } from './random';

/**
 * Budget selection: N tests placed as well as the pool allows. The pool is every allowed cell over the
 * dimensions given (constraints applied), one value index per dimension. The rules, in order:
 *
 * 1. Pair coverage is the hard rule. Each pick is the candidate that covers the most still-uncovered
 *    allowed pairs. Once every allowed pair is covered, this count is zero for every candidate and the
 *    balance rule decides alone.
 * 2. Latin hypercube balance breaks the ties. A candidate scores the sum, over its dimensions, of the fair
 *    share of its value minus the count that value already has. The fair share of a dimension is N divided
 *    by its allowed value count (the values some pool cell holds). A value short of its share scores high.
 * 3. A seeded shuffle breaks what is left. The first candidate of the shuffled order wins a tie.
 *
 * Pure: it reads nothing and writes nothing. Same pool, same budget, same stream: the same picks.
 */

/** The most pool cells the enumeration will hold before it refuses. */
export const MAX_POOL = 5_000_000;

export type BudgetSelection = {
  /** Indices into the pool, in pick order. */
  picked: number[];
  /** Allowed pairs of the pool and how many the picks cover. */
  pairs: { allowed: number; covered: number };
  /** Per dimension: the values some pool cell holds, and how many picks hold each value. */
  allowedValues: number[];
  counts: number[][];
};

/**
 * Enumerates every cell of the grid the sizes give (one value index per dimension, last dimension fastest)
 * and keeps the ones the check allows. Throws a RangeError when the grid is over MAX_POOL.
 */
export function enumerateCells(sizes: readonly number[], allowed: (cell: number[]) => boolean): number[][] {
  const total = sizes.reduce((product, size) => product * size, 1);
  if (total > MAX_POOL) {
    throw new RangeError(`the budget pool would hold ${total} cells: more than ${MAX_POOL}; split the map`);
  }
  const out: number[][] = [];
  if (sizes.length === 0 || total === 0) return out;
  const cell = sizes.map(() => 0);
  for (let code = 0; code < total; code += 1) {
    if (allowed(cell)) out.push([...cell]);
    for (let position = sizes.length - 1; position >= 0; position -= 1) {
      cell[position] = (cell[position] ?? 0) + 1;
      if ((cell[position] ?? 0) < (sizes[position] ?? 0)) break;
      cell[position] = 0;
    }
  }
  return out;
}

/** Picks cells by the three rules above. With reuse, numeric rows can share a categorical cell. */
export function selectBudget(
  pool: readonly (readonly number[])[],
  sizes: readonly number[],
  budget: number,
  rng: Rng,
  reuse = false,
): BudgetSelection {
  if (reuse && budget > MAX_POOL) throw new RangeError(`a numeric budget cannot exceed ${MAX_POOL} rows`);
  const width = sizes.length;
  // One index per allowed pair of two dimensions: the pair's offset plus the two values' product.
  const offset: number[][] = [];
  let pairSpace = 0;
  for (let i = 0; i < width; i += 1) {
    offset[i] = [];
    for (let j = i + 1; j < width; j += 1) {
      (offset[i] as number[])[j] = pairSpace;
      pairSpace += (sizes[i] ?? 0) * (sizes[j] ?? 0);
    }
  }
  const pairIndex = (i: number, a: number, j: number, b: number): number =>
    (offset[i]?.[j] ?? 0) + a * (sizes[j] ?? 0) + b;

  const inPool = new Uint8Array(pairSpace);
  const presentValues = sizes.map((size) => new Uint8Array(size));
  for (const row of pool) {
    row.forEach((value, dimension) => {
      const present = presentValues[dimension];
      if (present) present[value] = 1;
    });
    for (let i = 0; i < width; i += 1)
      for (let j = i + 1; j < width; j += 1) inPool[pairIndex(i, row[i] ?? 0, j, row[j] ?? 0)] = 1;
  }
  const allowedValues = presentValues.map((present) => present.reduce((sum, bit) => sum + bit, 0));
  const allowedPairs = inPool.reduce((sum, bit) => sum + bit, 0);

  const covered = new Uint8Array(pairSpace);
  const counts = sizes.map((size) => Array.from({ length: size }, () => 0));
  const taken = new Uint8Array(pool.length);
  const order = shuffle(rng, range(pool.length));
  const picked: number[] = [];
  const steps = reuse && pool.length > 0 ? budget : Math.min(budget, pool.length);
  let coveredPairs = 0;

  for (let step = 0; step < steps; step += 1) {
    let best = -1;
    let bestGain = -1;
    let bestBalance = Number.NEGATIVE_INFINITY;
    for (const index of order) {
      if (!reuse && taken[index]) continue;
      const row = pool[index] ?? [];
      let gain = 0;
      for (let i = 0; i < width; i += 1)
        for (let j = i + 1; j < width; j += 1)
          if (!covered[pairIndex(i, row[i] ?? 0, j, row[j] ?? 0)]) gain += 1;
      let balance = 0;
      // Every row has one value per dimension, so the sum of fair shares is constant. Cancel it
      // to compare integer deficits exactly: rounding must not override the seeded tie-break.
      for (let dimension = 0; dimension < width; dimension += 1)
        balance -= counts[dimension]?.[row[dimension] ?? 0] ?? 0;
      if (gain > bestGain || (gain === bestGain && balance > bestBalance)) {
        best = index;
        bestGain = gain;
        bestBalance = balance;
      }
    }
    if (best < 0) break;
    taken[best] = 1;
    picked.push(best);
    const row = pool[best] ?? [];
    for (let i = 0; i < width; i += 1)
      for (let j = i + 1; j < width; j += 1) {
        const at = pairIndex(i, row[i] ?? 0, j, row[j] ?? 0);
        if (!covered[at]) {
          covered[at] = 1;
          coveredPairs += 1;
        }
      }
    row.forEach((value, dimension) => {
      const column = counts[dimension];
      if (column) column[value] = (column[value] ?? 0) + 1;
    });
  }
  return { picked, pairs: { allowed: allowedPairs, covered: coveredPairs }, allowedValues, counts };
}

/**
 * Latin hypercube draw, optionally sliced by categorical row. Without slices, preserves the ordinary
 * seeded draw. With slices, interval matching assigns each slice band a distinct global band, then
 * jitters inside their intersection. Every global band and every band of each slice has one point.
 * Slice sizes may differ. Output positions correspond to the input slice labels.
 */
export function slicedLhs(
  rng: Rng,
  low: number,
  high: number,
  n: number,
  slices?: readonly string[],
): number[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a whole number of at least 1');
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(high - low) || high < low)
    throw new RangeError('low and high must give a finite range with high at least low');
  if (slices !== undefined && n > MAX_POOL)
    throw new RangeError(`a sliced draw cannot exceed ${MAX_POOL} rows`);
  const width = (high - low) / n;
  const bands = range(n);
  if (slices === undefined) return shuffle(rng, bands).map((band) => low + (band + rng()) * width);
  if (slices.length !== n) throw new RangeError('one categorical slice label is required per row');

  const members = new Map<string, number[]>();
  slices.forEach((slice, row) => {
    const own = members.get(slice) ?? [];
    own.push(row);
    members.set(slice, own);
  });
  type Band = { row: number; band: number; size: number; start: number; end: number; priority: number };
  const tokens = [...members.values()].flatMap((rows) =>
    shuffle(rng, rows).map((row, band) => ({
      row,
      band,
      size: rows.length,
      start: Math.floor((n * band) / rows.length),
      end: Math.ceil((n * (band + 1)) / rows.length) - 1,
      priority: 0,
    })),
  );
  shuffle(rng, tokens).forEach((token, priority) => {
    token.priority = priority;
  });
  tokens.sort((a, b) => a.start - b.start || a.end - b.end || a.priority - b.priority);
  // Earliest-deadline interval matching, using a min-heap: O(n log n), including unequal slices.
  const heap: Band[] = [];
  const before = (a: Band, b: Band) => a.end < b.end || (a.end === b.end && a.priority < b.priority);
  const push = (token: Band) => {
    let at = heap.length;
    heap.push(token);
    while (at > 0) {
      const parent = Math.floor((at - 1) / 2);
      const previous = heap[parent] as Band;
      if (!before(token, previous)) break;
      heap[at] = previous;
      at = parent;
    }
    heap[at] = token;
  };
  const pop = (): Band | undefined => {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1] as Band, heap[child] as Band)) child++;
        if (!before(heap[child] as Band, last)) break;
        heap[at] = heap[child] as Band;
        at = child;
      }
      heap[at] = last;
    }
    return first;
  };
  const values = new Array<number>(n);
  let cursor = 0;
  for (const fine of bands) {
    while (cursor < tokens.length && (tokens[cursor]?.start ?? n) <= fine) push(tokens[cursor++] as Band);
    const token = pop();
    if (!token || token.end < fine) throw new Error('could not match a slice band to a global band');
    const bottom = Math.max(fine / n, token.band / token.size);
    const top = Math.min((fine + 1) / n, (token.band + 1) / token.size);
    let quantile = bottom + rng() * (top - bottom);
    // Endpoint rounding must never move a point into a neighbouring band.
    if (Math.floor(quantile * n) !== fine || Math.floor(quantile * token.size) !== token.band)
      quantile = (bottom + top) / 2;
    values[token.row] = low + quantile * (high - low);
  }
  return values;
}
