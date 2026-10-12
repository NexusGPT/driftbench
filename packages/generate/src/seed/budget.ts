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

/** Picks `budget` cells of the pool by the three rules above. The pool holds cells over `sizes.length` dimensions. */
export function selectBudget(
  pool: readonly (readonly number[])[],
  sizes: readonly number[],
  budget: number,
  rng: Rng,
): BudgetSelection {
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
  const fair = allowedValues.map((count) => (count === 0 ? 0 : budget / count));
  const taken = new Uint8Array(pool.length);
  const order = shuffle(rng, range(pool.length));
  const picked: number[] = [];
  const steps = Math.min(budget, pool.length);
  let coveredPairs = 0;

  for (let step = 0; step < steps; step += 1) {
    let best = -1;
    let bestGain = -1;
    let bestBalance = Number.NEGATIVE_INFINITY;
    for (const index of order) {
      if (taken[index]) continue;
      const row = pool[index] ?? [];
      let gain = 0;
      for (let i = 0; i < width; i += 1)
        for (let j = i + 1; j < width; j += 1)
          if (!covered[pairIndex(i, row[i] ?? 0, j, row[j] ?? 0)]) gain += 1;
      let balance = 0;
      for (let dimension = 0; dimension < width; dimension += 1)
        balance += (fair[dimension] ?? 0) - (counts[dimension]?.[row[dimension] ?? 0] ?? 0);
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
 * Sliced Latin hypercube draw of `n` numbers in [low, high]: the range is cut into n equal bands, one value
 * is drawn uniformly inside each band, and the bands are shuffled, so the values spread between the band
 * boundaries and no band is visited twice. Returns the values in draw order.
 */
export function slicedLhs(rng: Rng, low: number, high: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a whole number of at least 1');
  if (!(high >= low)) throw new RangeError('high must be at least low');
  const width = (high - low) / n;
  const bands = range(n);
  return shuffle(rng, bands).map((band) => low + (band + rng()) * width);
}
