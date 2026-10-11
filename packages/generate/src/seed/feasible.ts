import type { CompiledSpace } from '@driftbench/space';
import { type Rng, range, shuffle } from './random';

/**
 * Which partial cells the constraint list allows. A partial cell (some dimensions fixed) is allowed when
 * at least one allowed cell of the full grid holds it: the definition of an allowed t-tuple in
 * constrained combinatorial testing (NIST SP 800-142), the one `@driftbench/space` counts coverage with.
 * The full grid is never enumerated: a depth-first search fixes the given values, then tries the values of
 * every other dimension, and drops a branch as soon as a constraint matches. A map with 46 dimensions has
 * a grid far larger than any enumeration; the search touches one cell per answer.
 */

/** A partial cell: pairs of a dimension index and a value index. */
export type Partial = ReadonlyArray<readonly [dimension: number, value: number]>;

export class Feasibility {
  private readonly sizes: number[];
  /** For each dimension, the constraints that name it. */
  private readonly touching: number[][];
  private readonly cache = new Map<string, boolean>();

  constructor(private readonly space: CompiledSpace) {
    this.sizes = space.dimensions.map((dimension) => dimension.values.length);
    this.touching = this.sizes.map(() => []);
    space.constraints.forEach((constraint, index) => {
      for (const [dimension] of constraint) this.touching[dimension]?.push(index);
    });
  }

  /** The number of dimensions of the map. */
  get width(): number {
    return this.sizes.length;
  }

  /** True when an allowed full cell holds every pair given. Answers are cached. */
  allowed(partial: Partial): boolean {
    const key = keyOf(partial);
    const known = this.cache.get(key);
    if (known !== undefined) return known;
    const result = this.complete(partial) !== undefined;
    this.cache.set(key, result);
    return result;
  }

  /**
   * An allowed full cell that holds every pair given, or undefined. Without a stream the values are tried
   * in map order (the first allowed cell); with one, in a shuffled order per dimension (a seeded cell).
   */
  complete(partial: Partial, rng?: Rng, order?: readonly number[]): number[] | undefined {
    const cell = this.sizes.map(() => -1);
    for (const [dimension, value] of partial) {
      const current = cell[dimension];
      if (current !== undefined && current >= 0 && current !== value) return undefined;
      cell[dimension] = value;
    }
    const fixed = partial.map(([dimension]) => dimension);
    const rest = (order ?? range(this.sizes.length)).filter((dimension) => !fixed.includes(dimension));
    const visit = [...new Set(fixed), ...rest];
    return this.search(cell, visit, 0, rng) ? cell : undefined;
  }

  private search(cell: number[], visit: number[], position: number, rng: Rng | undefined): boolean {
    if (position === visit.length) return true;
    const dimension = visit[position] as number;
    if ((cell[dimension] ?? -1) >= 0) {
      return this.consistent(cell, dimension) && this.search(cell, visit, position + 1, rng);
    }
    const size = this.sizes[dimension] ?? 0;
    const values = rng ? shuffle(rng, range(size)) : range(size);
    for (const value of values) {
      cell[dimension] = value;
      if (this.consistent(cell, dimension) && this.search(cell, visit, position + 1, rng)) return true;
    }
    cell[dimension] = -1;
    return false;
  }

  /** False when a constraint naming the dimension has every one of its values in the cell. */
  private consistent(cell: readonly number[], dimension: number): boolean {
    for (const index of this.touching[dimension] ?? []) {
      const constraint = this.space.constraints[index];
      if (!constraint || constraint.length === 0) continue;
      if (constraint.every(([at, value]) => cell[at] === value)) return false;
    }
    return true;
  }
}

/** A cache key for a partial cell, independent of the order of its pairs. */
export function keyOf(partial: Partial): string {
  return [...partial]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(',');
}
