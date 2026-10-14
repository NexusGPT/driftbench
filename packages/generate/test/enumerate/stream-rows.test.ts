import { describe, expect, it } from 'vitest';
import { rngFor } from '../../src/seed/random';
import * as twise from '../../src/seed/twise';

describe('covering rows without retained output', () => {
  it('emits the identical covering array one row at a time and returns only its count', () => {
    expect(twise).toHaveProperty('visitCoveringArray');
    const feasibility = {
      allowed: (picks: readonly (readonly [number, number])[]) =>
        !picks.some(([dimension, value]) => dimension === 0 && value === 2),
    };
    const sizes = [3, 4, 2];
    const dimensions = [0, 1, 2];
    const eager = twise.coveringArray(feasibility, sizes, dimensions, 2, rngFor(9, 'rows'), Infinity);
    const observed: number[][] = [];
    const summary = twise.visitCoveringArray(
      feasibility,
      sizes,
      dimensions,
      2,
      rngFor(9, 'rows'),
      Infinity,
      (row) => observed.push(row),
    );
    expect(observed).toEqual(eager.rows);
    expect(summary).toEqual({ ...eager, rows: eager.rows.length });
    expect(typeof summary.rows).toBe('number');
  });
});
