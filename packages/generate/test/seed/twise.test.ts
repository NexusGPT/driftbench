import { compileSpace, isForbidden, type SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { Feasibility } from '../../src/seed/feasible';
import { rngFor } from '../../src/seed/random';
import { allowedTuples, coveringArray, tupleKey } from '../../src/seed/twise';

function grid(sizes: number[], constraints: SpaceMap['constraints'] = []): SpaceMap {
  return {
    version: '1',
    agent: 'test',
    dimensions: sizes.map((size, index) => ({
      id: `d${index}`,
      title: `d${index}`,
      kind: 'persona' as const,
      values: Array.from({ length: size }, (_, value) => ({ id: `d${index}v${value}`, title: 'v' })),
    })),
    constraints,
    prior: { kind: 'declared' },
  };
}

/** True when some row holds every pair of the tuple key. */
function covers(rows: number[][], key: string): boolean {
  const pairs = key.split(',').map((part) => part.split('=').map(Number));
  return rows.some((row) => pairs.every(([dimension, value]) => row[dimension ?? -1] === value));
}

describe('coveringArray', () => {
  it('covers every pair of four binary dimensions in few rows', () => {
    const map = grid([2, 2, 2, 2]);
    const space = compileSpace(map);
    const feasibility = new Feasibility(space);
    const array = coveringArray(feasibility, [2, 2, 2, 2], [0, 1, 2, 3], 2, rngFor(1, 'twise'), Infinity);
    // 6 subsets of 2 dimensions, 4 pairs each.
    expect(array.allowed).toBe(24);
    expect(array.covered).toBe(24);
    // The full grid has 16 cells; a greedy pairwise array of 4 binary factors needs 5 or 6 (the optimum is 5).
    expect(array.rows.length).toBeLessThanOrEqual(6);
    expect(array.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('honours the constraints: no row is a forbidden cell, and every allowed pair is in a row', () => {
    const map = grid(
      [3, 2, 3, 2],
      [
        { forbid: { d0: 'd0v0', d1: 'd1v1' }, reason: 'r' },
        { forbid: { d2: 'd2v2', d3: 'd3v0' }, reason: 'r' },
        { forbid: { d0: 'd0v2', d2: 'd2v1', d3: 'd3v1' }, reason: 'r' },
      ],
    );
    const space = compileSpace(map);
    const feasibility = new Feasibility(space);
    const sizes = [3, 2, 3, 2];
    const array = coveringArray(feasibility, sizes, [0, 1, 2, 3], 2, rngFor(3, 'twise'), Infinity);
    for (const row of array.rows) expect(isForbidden(space, row)).toBe(false);
    const tuples = allowedTuples(feasibility, sizes, [0, 1, 2, 3], 2);
    for (const tuple of tuples) {
      expect(covers(array.rows, tupleKey(tuple.dimensions, tuple.values))).toBe(true);
    }
    expect(array.covered).toBe(tuples.length);
  });

  it('covers every allowed triple at t = 3', () => {
    const map = grid([2, 3, 2, 2], [{ forbid: { d0: 'd0v1', d1: 'd1v2' }, reason: 'r' }]);
    const feasibility = new Feasibility(compileSpace(map));
    const array = coveringArray(feasibility, [2, 3, 2, 2], [0, 1, 2, 3], 3, rngFor(1, 'twise'), Infinity);
    expect(array.covered).toBe(array.allowed);
    expect(array.allowed).toBeGreaterThan(0);
  });

  it('gives the same rows for the same seed, and stops at maxRows with the coverage reached', () => {
    const map = grid([3, 3, 3, 3, 3]);
    const feasibility = new Feasibility(compileSpace(map));
    const sizes = [3, 3, 3, 3, 3];
    const first = coveringArray(feasibility, sizes, [0, 1, 2, 3, 4], 2, rngFor(5, 'twise'), Infinity);
    const again = coveringArray(feasibility, sizes, [0, 1, 2, 3, 4], 2, rngFor(5, 'twise'), Infinity);
    expect(again.rows).toEqual(first.rows);
    const cut = coveringArray(feasibility, sizes, [0, 1, 2, 3, 4], 2, rngFor(5, 'twise'), 3);
    expect(cut.rows).toHaveLength(3);
    expect(cut.covered).toBeLessThan(cut.allowed);
    // Three rows cover at most 3 x 10 pairs.
    expect(cut.covered).toBeLessThanOrEqual(30);
  });

  it('leaves the dimensions outside the array at -1', () => {
    const map = grid([2, 2, 2]);
    const feasibility = new Feasibility(compileSpace(map));
    const array = coveringArray(feasibility, [2, 2, 2], [0, 2], 2, rngFor(1, 'twise'), Infinity);
    for (const row of array.rows) expect(row[1]).toBe(-1);
    expect(array.rows).toHaveLength(4);
  });
});
