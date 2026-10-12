import { describe, expect, it } from 'vitest';
import { type CoverElement, selectGolden } from '../../src/select';
import { selectGolden as reference } from './cover-reference';

/** A small seeded generator, so the pools are the same on every run. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function pool(seed: number, specs: number, cells: number) {
  const next = rng(seed);
  const ids = Array.from({ length: specs }, (_, i) => `s-${i}`);
  const element = (kind: string, count: number): CoverElement[] =>
    Array.from({ length: count }, (_, i) => ({
      key: `${kind}-${i}`,
      label: `${kind} ${i}`,
      specs: ids.filter(() => next() < 0.08),
    }));
  const evidence = new Map(
    ids.map((id) => [id, Array.from({ length: 6 }, (_, f) => `f${f}`).filter(() => next() < 0.15)]),
  );
  return { pool: ids, cells: element('cell', cells), required: element('req', 6), evidence };
}

describe('selectGolden picks the same specs in the same order as a full scan at every step', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('on pool %i, whole cover and k best', (seed) => {
    const input = pool(seed, 40 + seed * 7, 30 + seed * 5);
    expect(selectGolden(input)).toEqual(reference(input));
    for (const k of [1, 3, 8]) expect(selectGolden({ ...input, k })).toEqual(reference({ ...input, k }));
  });
});

describe('selectGolden cost', () => {
  it('grows no faster than the pool times the picks, not the pool times the cells', () => {
    const cpu = (specs: number) => {
      const chain = Array.from({ length: specs }, (_, i) => `s-${i}`);
      const cells = Array.from({ length: specs + 1 }, (_, c) => ({
        key: `c-${c}`,
        label: `cell ${c}`,
        specs: [c - 1, c].filter((i) => i >= 0 && i < specs).map((i) => `s-${i}`),
      }));
      const before = process.cpuUsage();
      selectGolden({ pool: chain, cells, required: [] });
      const used = process.cpuUsage(before);
      return (used.user + used.system) / 1000;
    };
    cpu(300);
    const small = Math.max(cpu(500), 1);
    const large = cpu(5000);
    expect(large / small).toBeLessThan(40);
  });
});
