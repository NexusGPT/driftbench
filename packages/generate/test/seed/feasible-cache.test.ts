import { compileSpace, type SpaceMap } from '@agent-nexus/driftbench-space';
import { expect, it } from 'vitest';
import { Feasibility } from '../../src/seed/feasible';

it('evicts old feasibility answers after a bounded query history without changing their result', () => {
  const map: SpaceMap = {
    version: '1',
    agent: 'cache-test',
    prior: { kind: 'declared' },
    // Distinct forbidden extensions prevent equivalent-value memoisation from collapsing this history.
    constraints: Array.from({ length: 257 }, (_, index) =>
      ['a', 'b'].map((dimension) => ({
        forbid: { [dimension]: `v${index}`, c: `v${index}` },
        reason: 'distinct extension',
      })),
    ).flat(),
    dimensions: ['a', 'b', 'c'].map((id) => ({
      id,
      title: id,
      kind: 'data',
      values: Array.from({ length: 257 }, (_, index) => ({ id: `v${index}`, title: `value ${index}` })),
    })),
  };
  const feasibility = new Feasibility(compileSpace(map));
  const complete = feasibility.complete.bind(feasibility);
  let searches = 0;
  feasibility.complete = (...args) => {
    searches += 1;
    return complete(...args);
  };
  const first = [
    [0, 0],
    [1, 0],
  ] as const;
  expect(feasibility.allowed(first)).toBe(true);
  for (let index = 1; index <= 65_536; index += 1) {
    feasibility.allowed([
      [0, Math.floor(index / 257)],
      [1, index % 257],
    ]);
  }
  const before = searches;
  expect(feasibility.allowed(first)).toBe(true);
  expect(searches).toBe(before + 1);
  expect(feasibility.allowed(first)).toBe(true);
  expect(searches).toBe(before + 1);
});

it('checks equivalent candidate extensions once while retaining order, duplicates and fixed values', () => {
  const map: SpaceMap = {
    version: '1',
    agent: 'candidate-test',
    prior: { kind: 'declared' },
    dimensions: ['a', 'b'].map((id) => ({
      id,
      title: id,
      kind: 'data',
      values: Array.from({ length: 512 }, (_, index) => ({ id: `v${index}`, title: `value ${index}` })),
    })),
    constraints: Array.from({ length: 256 }, (_, index) => ({
      forbid: { a: `v${index}`, b: 'v0' },
      reason: 'one forbidden extension',
    })),
  };
  const feasibility = new Feasibility(compileSpace(map));
  const values = Array.from({ length: 512 }, (_, index) => 511 - index);
  values.push(511);
  const allowed = feasibility.allowed.bind(feasibility);
  let queries = 0;
  feasibility.allowed = (cell) => {
    queries += 1;
    return allowed(cell);
  };
  expect(feasibility.allowedValues([[1, 0]], 0, values)).toEqual(values.filter((value) => value >= 256));
  expect(queries).toBeLessThanOrEqual(2);
  for (const cell of [
    [],
    [[0, 300]],
    [[0, 0]],
    [
      [0, 0],
      [0, 1],
    ],
    [[1, 0]],
    [[1, 4]],
  ] as const) {
    for (const dimension of [0, 1, 2]) {
      const candidates = [511, 300, 0, 1, 300, -1, 512, 1.5];
      expect(feasibility.allowedValues(cell, dimension, candidates)).toEqual(
        candidates.filter((value) => allowed([...cell, [dimension, value]])),
      );
    }
  }
});
