import type { CompiledSpace } from '@agent-nexus/driftbench-space';
import { type Rng, range, shuffle } from './random';

/**
 * Which partial cells the constraint list allows. A partial cell (some dimensions fixed) is allowed when
 * at least one allowed cell of the full grid holds it: the definition of an allowed t-tuple in
 * constrained combinatorial testing (NIST SP 800-142), the one `@agent-nexus/driftbench-space` counts coverage with.
 * The full grid is never enumerated: a depth-first search fixes the given values, then tries the values of
 * every other dimension, and drops a branch as soon as a constraint matches. A map with 46 dimensions has
 * a grid far larger than any enumeration; the search touches one cell per answer.
 *
 * The search visits the dimensions the constraints name first, the most named first, and the free ones
 * last: a free dimension never forces a step back, so a partial cell no allowed cell holds is refuted
 * within the constrained dimensions, never by walking the product of every free one.
 */

/** A partial cell: pairs of a dimension index and a value index. */
export type Partial = ReadonlyArray<readonly [dimension: number, value: number]>;

/** Memoisation is an acceleration only; its memory must not grow with generated scenarios. */
const MAX_CACHED_CELLS = 65_536;

export class Feasibility {
  private readonly sizes: number[];
  private readonly representatives: number[][];
  /** Immutable ranges are reused; shuffle still copies and consumes the original random draws. */
  private readonly valueOrders: Array<readonly number[] | undefined>;
  /** Only constraints naming the chosen value can forbid a cell. */
  private readonly touchingValue: Map<number, number[]>[];
  private readonly cache = new Map<string | number, boolean>();
  /** Mixed-radix keys only when every partial cell fits an exact JavaScript integer. */
  private readonly weights: number[] | undefined;
  /** The visiting order: constrained dimensions first, the most constrained first, then map order. */
  private readonly order: number[];

  constructor(private readonly space: CompiledSpace) {
    this.sizes = space.dimensions.map((dimension) => dimension.values.length);
    this.valueOrders = new Array(this.sizes.length);
    this.representatives = equivalentValues(space, this.sizes);
    let product = 1;
    const weights = this.sizes.map((size) => {
      const weight = product;
      product *= size + 1;
      return weight;
    });
    this.weights = this.sizes.length <= 32 && Number.isSafeInteger(product) ? weights : undefined;
    this.touchingValue = this.sizes.map(() => new Map());
    const touching = this.sizes.map(() => 0);
    space.constraints.forEach((constraint, index) => {
      for (const [dimension, value] of constraint) {
        const byValue = this.touchingValue[dimension];
        if (!byValue) continue;
        touching[dimension] = (touching[dimension] ?? 0) + 1;
        const indices = byValue.get(value) ?? [];
        indices.push(index);
        byValue.set(value, indices);
      }
    });
    // Preserve the search order, including seeded searches' random draws.
    this.order = range(this.sizes.length).sort((a, b) => (touching[b] ?? 0) - (touching[a] ?? 0) || a - b);
  }

  /** The number of dimensions of the map. */
  get width(): number {
    return this.sizes.length;
  }

  /** True when an allowed full cell holds every pair given. Answers are cached. */
  allowed(partial: Partial): boolean {
    const key = this.cacheKey(partial);
    const known = this.cache.get(key);
    if (known !== undefined) return known;
    const result = this.complete(partial) !== undefined;
    if (this.cache.size >= MAX_CACHED_CELLS) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }

  /** Values of one dimension that can extend the partial cell, in the caller's order. */
  allowedValues(partial: Partial, dimension: number, values: readonly number[]): number[] {
    // A fixed value is an equality requirement even when another value has identical constraints.
    const representatives = this.representatives[dimension];
    if (!representatives || partial.some(([at]) => at === dimension))
      return values.filter((value) => this.allowed([...partial, [dimension, value]]));
    const answers = new Map<number, boolean>();
    const allowed: number[] = [];
    for (const value of values) {
      const representative = representatives[value];
      let answer = representative === undefined ? undefined : answers.get(representative);
      if (answer === undefined) {
        answer = this.allowed([...partial, [dimension, value]]);
        if (representative !== undefined) answers.set(representative, answer);
      }
      if (answer) allowed.push(value);
    }
    return allowed;
  }

  private cacheKey(partial: Partial): string | number {
    if (!this.weights) return keyOf(partial);
    let key = 0;
    let held = 0;
    for (const [dimension, value] of partial) {
      const weight = this.weights[dimension];
      const size = this.sizes[dimension];
      if (
        weight === undefined ||
        size === undefined ||
        !Number.isInteger(value) ||
        value < 0 ||
        value >= size ||
        (held & (1 << dimension)) !== 0
      )
        return keyOf(partial);
      held |= 1 << dimension;
      // Zero is an unspecified dimension; values occupy digits 1 through size.
      key += ((this.representatives[dimension]?.[value] ?? value) + 1) * weight;
    }
    return key;
  }

  /**
   * An allowed full cell that holds every pair given, or undefined. Without a stream the values are tried
   * in map order (the first allowed cell); with one, in a shuffled order per dimension (a seeded cell).
   */
  complete(partial: Partial, rng?: Rng, order?: readonly number[]): number[] | undefined {
    if (
      !rng &&
      order === undefined &&
      this.sizes.length <= 32 &&
      partial.every(
        ([dimension, value]) =>
          Number.isInteger(dimension) &&
          dimension >= 0 &&
          dimension < this.sizes.length &&
          Number.isInteger(value) &&
          value >= 0 &&
          value < (this.sizes[dimension] ?? 0),
      )
    ) {
      const cell = new Array<number>(this.sizes.length).fill(-1);
      let held = 0;
      for (const [dimension, value] of partial) {
        if ((cell[dimension] ?? -1) >= 0 && cell[dimension] !== value) return undefined;
        cell[dimension] = value;
        held |= 1 << dimension;
      }
      // Refute fixed conflicts before allocating a traversal of the free dimensions.
      for (const [dimension] of partial) if (!this.consistent(cell, dimension)) return undefined;
      const visit = this.order.filter((dimension) => (held & (1 << dimension)) === 0);
      return this.search(cell, visit, 0, undefined) ? cell : undefined;
    }
    const cell = this.sizes.map(() => -1);
    for (const [dimension, value] of partial) {
      const current = cell[dimension];
      if (current !== undefined && current >= 0 && current !== value) return undefined;
      cell[dimension] = value;
    }
    const fixed = partial.map(([dimension]) => dimension);
    const rest = (order ?? this.order).filter((dimension) => !fixed.includes(dimension));
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
    // An unseeded search usually accepts the first value. Do not allocate the whole dimension's
    // range for every recursive visit. Seeded searches keep the same shuffle and random draws.
    let values: number[] | undefined;
    if (rng) {
      let order = this.valueOrders[dimension];
      if (!order) {
        order = range(size);
        if (Number.isInteger(dimension) && dimension >= 0 && dimension < this.valueOrders.length)
          this.valueOrders[dimension] = order;
      }
      values = shuffle(rng, order);
    }
    for (let index = 0; index < size; index += 1) {
      const value = values?.[index] ?? index;
      cell[dimension] = value;
      if (this.consistent(cell, dimension) && this.search(cell, visit, position + 1, rng)) return true;
    }
    cell[dimension] = -1;
    return false;
  }

  /** False when a constraint naming the dimension has every one of its values in the cell. */
  private consistent(cell: readonly number[], dimension: number): boolean {
    for (const index of this.touchingValue[dimension]?.get(cell[dimension] ?? -1) ?? []) {
      const constraint = this.space.constraints[index];
      if (!constraint || constraint.length === 0) continue;
      if (constraint.every(([at, value]) => cell[at] === value)) return false;
    }
    return true;
  }
}

/**
 * Values with the same forbidden extensions are interchangeable for existence queries. Replacing one
 * by another preserves every constraint for every assignment of the other dimensions. This never
 * rewrites a requested completion or the seeded search order, only a boolean memoisation key.
 */
function equivalentValues(space: CompiledSpace, sizes: readonly number[]): number[][] {
  const identity = sizes.map((size) => range(size));
  // Keep the generic behavior for noncanonical constraint inputs (including repeated dimensions).
  if (
    space.constraints.some((constraint) => {
      const dimensions = new Set<number>();
      return constraint.some(([dimension, value]) => {
        if (
          !Number.isInteger(dimension) ||
          dimension < 0 ||
          dimension >= sizes.length ||
          !Number.isInteger(value) ||
          value < 0 ||
          value >= (sizes[dimension] ?? 0) ||
          dimensions.has(dimension)
        )
          return true;
        dimensions.add(dimension);
        return false;
      });
    })
  )
    return identity;
  const tails = sizes.map((size) => new Array<Set<string> | undefined>(size));
  for (const constraint of space.constraints) {
    for (const [dimension, value] of constraint) {
      const byValue = tails[dimension];
      if (!byValue) continue;
      const clauses = byValue[value] ?? new Set<string>();
      clauses.add(keyOf(constraint.filter(([at]) => at !== dimension)));
      byValue[value] = clauses;
    }
  }
  return identity.map((values, dimension) => {
    const classes = new Map<string, number>();
    return values.map((value) => {
      const signature = JSON.stringify([...(tails[dimension]?.[value] ?? [])].sort());
      const first = classes.get(signature);
      if (first !== undefined) return first;
      classes.set(signature, value);
      return value;
    });
  });
}

/** A cache key for a partial cell, independent of the order of its pairs. */
export function keyOf(partial: Partial): string {
  return [...partial]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(',');
}
