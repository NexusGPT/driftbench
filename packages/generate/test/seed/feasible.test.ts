import { cells, compileSpace, isForbidden, type SpaceMap } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { Feasibility } from '../../src/seed/feasible';
import { rngFor } from '../../src/seed/random';
import { allowedTuples, tupleKey } from '../../src/seed/twise';

/** A: a1 a2 · B: b1 (one value) · C: c1 c2 c3 · D: d1 d2. */
const MAP: SpaceMap = {
  version: '1',
  agent: 'test',
  dimensions: [
    {
      id: 'A',
      title: 'A',
      kind: 'persona',
      values: [
        { id: 'a1', title: 'a1' },
        { id: 'a2', title: 'a2' },
      ],
    },
    { id: 'B', title: 'B', kind: 'channel', values: [{ id: 'b1', title: 'b1' }] },
    {
      id: 'C',
      title: 'C',
      kind: 'data',
      values: [
        { id: 'c1', title: 'c1' },
        { id: 'c2', title: 'c2' },
        { id: 'c3', title: 'c3' },
      ],
    },
    {
      id: 'D',
      title: 'D',
      kind: 'task',
      values: [
        { id: 'd1', title: 'd1' },
        { id: 'd2', title: 'd2' },
      ],
    },
  ],
  constraints: [
    // B has one value, so every cell with a1 is forbidden: (a1, c1) is not allowed though no constraint names A and C.
    { forbid: { A: 'a1', B: 'b1' }, reason: 'a1 never on b1' },
    { forbid: { C: 'c3', D: 'd2' }, reason: 'c3 only with d1' },
    { forbid: { A: 'a2', C: 'c2', D: 'd1' }, reason: 'a three-way exclusion' },
  ],
  prior: { kind: 'declared' },
};

describe('Feasibility', () => {
  const space = compileSpace(MAP);
  const feasibility = new Feasibility(space);

  it('refuses a pair no constraint names when every extension of it is forbidden', () => {
    expect(
      feasibility.allowed([
        [0, 0],
        [2, 0],
      ]),
    ).toBe(false);
    expect(
      feasibility.allowed([
        [0, 1],
        [2, 0],
      ]),
    ).toBe(true);
  });

  it('applies a three-way constraint only when all three values meet', () => {
    expect(
      feasibility.allowed([
        [0, 1],
        [2, 1],
      ]),
    ).toBe(true); // a2 c2 with d2
    expect(
      feasibility.allowed([
        [0, 1],
        [2, 1],
        [3, 0],
      ]),
    ).toBe(false);
  });

  it('completes a partial cell into an allowed full cell, seeded or not', () => {
    for (const rng of [undefined, rngFor(7, 'x'), rngFor(8, 'x')]) {
      const cell = feasibility.complete([[2, 2]], rng);
      expect(cell).toBeDefined();
      expect(cell?.[2]).toBe(2);
      expect(isForbidden(space, cell ?? [])).toBe(false);
    }
    expect(feasibility.complete([[0, 0]])).toBeUndefined();
  });

  it('counts the same allowed pairs and triples as the space package enumerates', () => {
    const sizes = space.dimensions.map((dimension) => dimension.values.length);
    for (const t of [1, 2, 3]) {
      const mine = allowedTuples(feasibility, sizes, [0, 1, 2, 3], t).map((tuple) =>
        tuple.dimensions
          .map(
            (dimension, index) =>
              `${MAP.dimensions[dimension]?.id}=${space.dimensions[dimension]?.values[tuple.values[index] ?? 0]?.id}`,
          )
          .join(','),
      );
      const theirs = cells(MAP, { t }).map((cell) =>
        Object.entries(cell.values)
          .map(([dimension, value]) => `${dimension}=${value}`)
          .join(','),
      );
      expect(new Set(mine)).toEqual(new Set(theirs));
    }
    // By hand: a2 is the only A value left, so the allowed cells are c1 d1, c1 d2, c2 d2, c3 d1 (c3 d2 is
    // forbidden, and c2 d1 through the three-way rule with a2). Pairs: A-B 1, A-C 3, A-D 2, B-C 3, B-D 2,
    // C-D 4, total 15.
    expect(allowedTuples(feasibility, sizes, [0, 1, 2, 3], 2)).toHaveLength(15);
  });

  it('does not rescan unrelated value constraints as a dimension grows', () => {
    const width = 256;
    const map: SpaceMap = {
      ...MAP,
      dimensions: [
        {
          id: 'A',
          title: 'A',
          kind: 'behaviour',
          values: Array.from({ length: width }, (_, index) => ({ id: `a${index}`, title: 'a' })),
        },
        {
          id: 'B',
          title: 'B',
          kind: 'channel',
          values: [
            { id: 'blocked', title: 'blocked' },
            { id: 'open', title: 'open' },
          ],
        },
      ],
      constraints: Array.from({ length: width }, (_, index) => ({
        forbid: { A: `a${index}`, B: 'blocked' },
        reason: 'blocked channel',
      })),
    };
    const space = compileSpace(map);
    let reads = 0;
    // Count constraint visits, independent of clock speed and concurrent test workers.
    for (const constraint of space.constraints) {
      const first = constraint[0];
      Object.defineProperty(constraint, 0, {
        get: () => {
          reads += 1;
          return first;
        },
      });
    }
    const feasibility = new Feasibility(space);
    reads = 0;
    for (let value = 0; value < width; value += 1) {
      expect(
        feasibility.complete([
          [0, value],
          [1, 1],
        ]),
      ).toEqual([value, 1]);
      expect(
        feasibility.allowed([
          [0, value],
          [1, 0],
        ]),
      ).toBe(false);
    }
    expect(reads).toBeLessThan(width * 8);
  });

  it('keeps missing values, reversed pairs and duplicate dimensions distinct in its cache', () => {
    const partials: Array<Array<[number, number]>> = [[]];
    for (const [dimension, entry] of space.dimensions.entries()) {
      const before = [...partials];
      for (const partial of before)
        for (let value = 0; value < entry.values.length; value += 1)
          partials.push([...partial, [dimension, value]]);
    }
    partials.push(
      [
        [0, 0],
        [0, 1],
      ],
      [
        [0, 1],
        [0, 1],
      ],
      [[0, -1]],
      [[0, 99]],
    );
    const cached = new Feasibility(space);
    for (const partial of partials) {
      const expected = new Feasibility(space).complete(partial) !== undefined;
      expect(cached.allowed(partial)).toBe(expected);
      expect(cached.allowed([...partial].reverse())).toBe(expected);
    }
  });

  it('keys a tuple by its dimensions and values', () => {
    expect(tupleKey([0, 2], [1, 0])).toBe('0=1,2=0');
  });
});
