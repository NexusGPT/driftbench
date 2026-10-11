import { describe, expect, it } from 'vitest';
import { type CoverElement, selectGolden } from '../../src/select';

/** Cells named c0, c1, ... each covered by the listed specs. */
function cells(...owners: string[][]): CoverElement[] {
  return owners.map((specs, index) => ({ key: `c${index}`, label: `c${index}`, specs }));
}

describe('selectGolden: the greedy cover', () => {
  it('takes the spec that adds the most cells first and stops once every coverable cell is covered', () => {
    // a covers 0-3, b covers 3-5, c covers 0-1, d covers 5: greedy takes a then b, and c and d add nothing.
    const selection = selectGolden({
      pool: ['a', 'b', 'c', 'd'],
      cells: cells(['a', 'c'], ['a', 'c'], ['a'], ['a', 'b'], ['b'], ['b', 'd'], []),
      required: [],
    });
    expect(selection.cover.map((pick) => pick.id)).toEqual(['a', 'b']);
    expect(selection.cover.map((pick) => pick.cells)).toEqual([4, 2]);
    expect(selection.cover.map((pick) => pick.cumulative)).toEqual([4, 6]);
    expect(selection.pool).toEqual({ specs: 4, cells: 6, required: 0, faults: 0 });
    expect(selection.covered.cells).toBe(6);
    expect(selection.totals).toEqual({ cells: 7, required: 0 });
    expect(selection.golden).toBe(selection.cover);
    expect(selection.kBest).toBe(false);
  });

  it('puts the required cells first, even before a spec that adds more cells', () => {
    const selection = selectGolden({
      pool: ['big', 'rare'],
      cells: cells(['big'], ['big'], ['big'], ['rare']),
      required: [{ key: 'r0', label: 'flow order · D4', specs: ['rare'] }],
    });
    expect(selection.cover.map((pick) => pick.id)).toEqual(['rare', 'big']);
    expect(selection.cover[0]?.required).toEqual(['flow order · D4']);
  });

  it('breaks a tie on cells by the faults a spec adds, then by the pool order', () => {
    const evidence = new Map([['second', ['x4-wrong-language']]]);
    const tied = selectGolden({
      pool: ['first', 'second'],
      cells: cells(['first', 'second']),
      required: [],
      evidence,
    });
    expect(tied.cover.map((pick) => pick.id)).toEqual(['second']);
    expect(tied.cover[0]?.faults).toEqual(['x4-wrong-language']);
    const plain = selectGolden({
      pool: ['first', 'second'],
      cells: cells(['first', 'second']),
      required: [],
    });
    expect(plain.cover.map((pick) => pick.id)).toEqual(['first']);
  });

  it('never takes a spec into the cover for its faults alone', () => {
    const selection = selectGolden({
      pool: ['cells', 'faults-only'],
      cells: cells(['cells']),
      required: [],
      evidence: new Map([['faults-only', ['d4-order-on-loose-yes']]]),
    });
    expect(selection.cover.map((pick) => pick.id)).toEqual(['cells']);
    expect(selection.pool.faults).toBe(1);
    expect(selection.covered.faults).toBe(0);
  });

  it('lists the required cells no spec covers, and leaves out specs that are not in the pool', () => {
    const selection = selectGolden({
      pool: ['a'],
      cells: cells(['a'], ['sealed']),
      required: [
        { key: 'r0', label: 'covered', specs: ['a'] },
        { key: 'r1', label: 'flow price-sheet · D6_instruction_in_data', specs: ['sealed'] },
      ],
    });
    expect(selection.cover.map((pick) => pick.id)).toEqual(['a']);
    expect(selection.pool.cells).toBe(1);
    expect(selection.uncoverable).toEqual(['flow price-sheet · D6_instruction_in_data']);
    expect(selection.missed).toEqual([]);
  });

  it('gives the same picks for the same input', () => {
    const input = {
      pool: ['s1', 's2', 's3', 's4'],
      cells: cells(['s1', 's2'], ['s2', 's3'], ['s3', 's4'], ['s4', 's1'], ['s2']),
      required: [],
      evidence: new Map([['s3', ['f1']]]),
    };
    expect(selectGolden(input)).toEqual(selectGolden(input));
  });
});

describe('selectGolden: the k best', () => {
  const pool = ['wide', 'killer', 'mid', 'small'];
  const many = cells(['wide'], ['wide'], ['wide'], ['wide'], ['mid'], ['mid'], ['mid', 'killer'], ['small']);

  it('keeps the cover when k is not smaller than it', () => {
    const selection = selectGolden({ pool, cells: many, required: [], k: 10 });
    expect(selection.kBest).toBe(false);
    expect(selection.golden).toBe(selection.cover);
  });

  it('ranks a fault no chosen spec turns red above any number of cells', () => {
    const evidence = new Map([['killer', ['x3-skips-recap']]]);
    const selection = selectGolden({ pool, cells: many, required: [], evidence, k: 2 });
    expect(selection.cover.map((pick) => pick.id)).toEqual(['wide', 'mid', 'small']);
    expect(selection.kBest).toBe(true);
    expect(selection.golden.map((pick) => pick.id)).toEqual(['killer', 'wide']);
    expect(selection.golden[0]?.faults).toEqual(['x3-skips-recap']);
    expect(selection.covered).toEqual({ cells: 5, required: 0, faults: 1 });
  });

  it('ranks required cells above faults', () => {
    const evidence = new Map([['killer', ['x3-skips-recap']]]);
    const selection = selectGolden({
      pool,
      cells: many,
      required: [{ key: 'r0', label: 'needed', specs: ['small'] }],
      evidence,
      k: 1,
    });
    expect(selection.golden.map((pick) => pick.id)).toEqual(['small']);
    expect(selection.missed).toEqual([]);
  });

  it('reports a required cell the pool covers that k is too small to keep', () => {
    const selection = selectGolden({
      pool: ['a', 'b'],
      cells: cells(['a'], ['b']),
      required: [
        { key: 'r0', label: 'first', specs: ['a'] },
        { key: 'r1', label: 'second', specs: ['b'] },
      ],
      k: 1,
    });
    expect(selection.golden.map((pick) => pick.id)).toEqual(['a']);
    expect(selection.missed).toEqual(['second']);
    expect(selection.covered.required).toBe(1);
  });
});
