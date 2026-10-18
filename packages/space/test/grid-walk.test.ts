import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CompiledConstraint,
  type CompiledSpace,
  compileSpace,
  forEachAllowedCell,
  isForbidden,
  parseSpaceMapText,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';

/**
 * forEachAllowedCell against the plain odometer it replaced: the same cells in the same order on every
 * shape of grid, and a count of constraint checks that follows the allowed cells, not the full grid.
 */

/** The odometer: every cell of the full grid in turn, each checked against every constraint. */
function odometer(space: CompiledSpace, visit: (cell: readonly number[]) => void): void {
  const sizes = space.dimensions.map((dimension) => dimension.values.length);
  const cell = sizes.map(() => 0);
  for (;;) {
    if (!isForbidden(space, cell)) visit(cell);
    let dimension = cell.length - 1;
    while (dimension >= 0) {
      const next = (cell[dimension] ?? 0) + 1;
      if (next < (sizes[dimension] ?? 0)) {
        cell[dimension] = next;
        break;
      }
      cell[dimension] = 0;
      dimension -= 1;
    }
    if (dimension < 0) return;
  }
}

/** A compiled space of the given sizes: only the fields the walk reads carry content. */
function grid(sizes: readonly number[], constraints: CompiledConstraint[]): CompiledSpace {
  return {
    map: {} as CompiledSpace['map'],
    dimensions: sizes.map((size, index) => ({
      id: `d${index}`,
      title: `d${index}`,
      kind: 'data',
      values: Array.from({ length: size }, (_, value) => ({ id: `v${value}`, title: `v${value}` })),
      index: new Map(),
      weights: [],
    })),
    constraints,
    uniform: true,
  };
}

/** The same space, with a count of how many times a constraint is checked against a cell. */
function counted(space: CompiledSpace): { space: CompiledSpace; checks: () => number } {
  let checks = 0;
  const constraints = space.constraints.map(
    (constraint) =>
      new Proxy(constraint, {
        get(target, key, receiver) {
          if (key === 'every') checks += 1;
          return Reflect.get(target, key, receiver);
        },
      }),
  );
  return { space: { ...space, constraints }, checks: () => checks };
}

const walked = (walk: typeof forEachAllowedCell, space: CompiledSpace): string[] => {
  const seen: string[] = [];
  walk(space, (cell) => seen.push(cell.join(',')));
  return seen;
};

/** A small seeded generator (mulberry32), so the random grids are the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('forEachAllowedCell', () => {
  it('visits the cells of the odometer, in its order, on 300 seeded grids', () => {
    const next = random(7);
    const pick = (n: number) => Math.floor(next() * n);
    for (let round = 0; round < 300; round += 1) {
      const sizes = Array.from({ length: 1 + pick(5) }, () => 1 + pick(4));
      const constraints = Array.from({ length: pick(9) }, (): CompiledConstraint => {
        const pairs: Array<[number, number]> = [];
        for (let dimension = 0; dimension < sizes.length; dimension += 1) {
          if (next() < 0.45) pairs.push([dimension, pick(sizes[dimension] ?? 1)]);
        }
        // Compiled constraints are sorted by dimension; a hand-built one may not be.
        return next() < 0.3 ? pairs.reverse() : pairs;
      });
      const space = grid(sizes, constraints);
      expect(walked(forEachAllowedCell, space), JSON.stringify({ sizes, constraints })).toEqual(
        walked(odometer, space),
      );
    }
  });

  it('agrees with the odometer on the edges: no dimension, no value, and constraints that match nothing', () => {
    const cases: CompiledSpace[] = [
      grid([], []),
      grid([], [[[0, 0]]]),
      grid([2, 0, 2], [[[0, 1]]]),
      grid([2, 2], [[]]),
      grid([2, 2], [[[5, 0]]]),
      grid(
        [2, 2],
        [
          [
            [-1, 0],
            [1, 1],
          ],
        ],
      ),
      grid(
        [2, 2],
        [
          [
            [0, 0],
            [0, 1],
          ],
        ],
      ),
      grid([2, 2], [[[0, 0]], [[0, 1]]]),
      grid(
        [3, 3],
        [
          [
            [1, 2],
            [0, 1],
          ],
        ],
      ),
    ];
    for (const space of cases) {
      expect(walked(forEachAllowedCell, space), JSON.stringify(space.constraints)).toEqual(
        walked(odometer, space),
      );
    }
    expect(walked(forEachAllowedCell, grid([], []))).toEqual(['']);
    expect(walked(forEachAllowedCell, grid([2, 2], [[[0, 0]], [[0, 1]]]))).toEqual([]);
  });

  it('checks a constraint once per value of its last dimension, not once per cell', () => {
    // 1000 cells; the one constraint forbids the first value of the first dimension, 100 cells.
    const one = counted(grid([10, 10, 10], [[[0, 0]]]));
    expect(walked(forEachAllowedCell, one.space)).toHaveLength(900);
    expect(one.checks()).toBe(10);
    const before = counted(grid([10, 10, 10], [[[0, 0]]]));
    expect(walked(odometer, before.space)).toHaveLength(900);
    expect(before.checks()).toBe(1000);
  });

  it('walks the Acme map with 1,452,292 constraint checks where the odometer makes 13,439,066', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../../examples/acme/map/space.yaml', import.meta.url)),
      'utf8',
    );
    const loaded = parseSpaceMapText(text, 'yaml');
    if (!loaded.ok) throw new Error('the Acme map did not load');
    const space = compileSpace(loaded.map);
    const fast = counted(space);
    const slow = counted(space);
    expect(walked(forEachAllowedCell, fast.space)).toEqual(walked(odometer, slow.space));
    expect({ fast: fast.checks(), slow: slow.checks() }).toEqual({ fast: 1_452_292, slow: 13_439_066 });
    // Both walks of the whole Acme map run here; on a shared CI runner that passes the default five seconds.
  }, 60_000);
});
