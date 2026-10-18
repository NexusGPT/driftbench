import {
  assertGridSize,
  cells,
  combinations,
  compileSpace,
  findAllowedCell,
  gridSize,
  isForbidden,
  resolveT,
} from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';
import { HAND, map } from './support';

const hand = map(HAND);
const label = (cell: { values: Record<string, string> }) => Object.values(cell.values).join(' ');

/**
 * Three dimensions x, y, z of two values each, and two constraints: x1 never with z1, y1 never with z2.
 * No constraint names x1 with y1, yet every cell holding both is forbidden (z1 by the first, z2 by the
 * second), so the pair (x1, y1) is not allowed.
 */
const IMPLICIT = map({
  version: '1',
  agent: 'implicit',
  dimensions: ['x', 'y', 'z'].map((id) => ({
    id,
    title: id,
    kind: id === 'x' ? 'behaviour' : 'data',
    values: [
      { id: `${id}1`, title: `${id}1` },
      { id: `${id}2`, title: `${id}2` },
    ],
  })),
  constraints: [
    { forbid: { x: 'x1', z: 'z1' }, reason: 'x1 never with z1.' },
    { forbid: { y: 'y1', z: 'z2' }, reason: 'y1 never with z2.' },
  ],
  prior: { kind: 'declared' },
});

describe('combinations', () => {
  it('lists the subsets of t out of k in lexicographic order', () => {
    expect(combinations(4, 2)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(combinations(3, 3)).toEqual([[0, 1, 2]]);
    expect(combinations(3, 1)).toEqual([[0], [1], [2]]);
    expect(combinations(2, 3)).toEqual([]);
  });
});

describe('the grid', () => {
  it('counts the cells before constraints', () => {
    expect(gridSize(hand)).toBe(8);
  });

  it('enumerates the full grid without the forbidden cells, last dimension fastest', () => {
    expect(cells(hand).map(label)).toEqual([
      'a none chat',
      'a none whatsapp',
      'a D4_loose_confirmation chat',
      'b none chat',
      'b none whatsapp',
      'b D4_loose_confirmation chat',
    ]);
  });

  it('enumerates the allowed pairs of every two dimensions: 11 of 12', () => {
    expect(cells(hand, { t: 2 }).map((cell) => Object.entries(cell.values).flat().join('='))).toEqual([
      'stage=a=deviation=none',
      'stage=a=deviation=D4_loose_confirmation',
      'stage=b=deviation=none',
      'stage=b=deviation=D4_loose_confirmation',
      'stage=a=channel=chat',
      'stage=a=channel=whatsapp',
      'stage=b=channel=chat',
      'stage=b=channel=whatsapp',
      'deviation=none=channel=chat',
      'deviation=none=channel=whatsapp',
      'deviation=D4_loose_confirmation=channel=chat',
    ]);
  });

  it('keeps a pair out when no allowed cell holds it, though no constraint names it', () => {
    const pairs = cells(IMPLICIT, { t: 2 }).map(label);
    expect(pairs).not.toContain('x1 y1');
    expect(pairs).toEqual(['x1 y2', 'x2 y1', 'x2 y2', 'x1 z2', 'x2 z1', 'x2 z2', 'y1 z1', 'y2 z1', 'y2 z2']);
    expect(cells(IMPLICIT).map(label)).toEqual(['x1 y2 z2', 'x2 y1 z1', 'x2 y2 z1', 'x2 y2 z2']);
  });

  it('drops a value everywhere when a constraint names it alone', () => {
    const solo = map({
      ...HAND,
      constraints: [...HAND.constraints, { forbid: { channel: 'whatsapp' }, reason: 'Not launched yet.' }],
    });
    expect(cells(solo, { t: 1 }).map(label)).toEqual(['a', 'b', 'none', 'D4_loose_confirmation', 'chat']);
  });

  it('finds one allowed cell by depth-first search, or none when everything is forbidden', () => {
    const space = compileSpace(IMPLICIT);
    expect(findAllowedCell(space)).toEqual([0, 1, 1]);
    const closed = compileSpace({
      ...IMPLICIT,
      constraints: [
        ...IMPLICIT.constraints,
        { forbid: { x: 'x2' }, reason: 'x2 never.' },
        { forbid: { y: 'y2', x: 'x1' }, reason: 'x1 never with y2.' },
      ],
    });
    expect(findAllowedCell(closed)).toBeUndefined();
  });

  it('tells a forbidden cell by its values', () => {
    const space = compileSpace(hand);
    expect(isForbidden(space, [0, 1, 1])).toBe(true);
    expect(isForbidden(space, [0, 1, 0])).toBe(false);
  });

  it('resolves t to the full grid by default and refuses one out of range', () => {
    const space = compileSpace(hand);
    expect(resolveT(space, undefined)).toBe(3);
    expect(() => resolveT(space, 0)).toThrow(RangeError);
    expect(() => resolveT(space, 4)).toThrow('t must be a whole number from 1 to 3');
    expect(() => resolveT(space, 1.5)).toThrow(RangeError);
  });

  it('refuses a full grid over the limit before enumerating it', () => {
    expect(() => assertGridSize(hand, 7)).toThrow('the full grid has 8 cells, over the limit of 7');
    expect(() => cells(hand, { maxCells: 7 })).toThrow(RangeError);
  });

  it("resolves weights: the prior's first, then the value's own, else every value the same", () => {
    const space = compileSpace(
      map({ ...HAND, prior: { kind: 'fitted', source: 'logs', weights: { stage: { a: 1, b: 0 } } } }),
    );
    expect(space.dimensions.map((dimension) => dimension.weights)).toEqual([
      [1, 0],
      [0.9, 0.1],
      [0.5, 0.5],
    ]);
    expect(space.uniform).toBe(false);
    expect(compileSpace(map({ ...HAND, dimensions: [HAND.dimensions[2]], constraints: [] })).uniform).toBe(
      true,
    );
  });
});
