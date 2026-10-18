import { designEffect, wilson } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { sessionRate } from '../src/index';

const runs = (sizes: number[], passes: number[]) =>
  sizes.flatMap((size, i) =>
    Array.from({ length: size }, (_, r) => ({ session: `session-${i}`, pass: r < (passes[i] as number) })),
  );

describe('sessionRate', () => {
  it('counts the session as the unit through the design effect', () => {
    const r = sessionRate(runs([2, 7, 3, 1, 5], [2, 4, 3, 0, 5]), { rho: 0.5 });
    expect(r.sessions).toBe(5);
    expect(r.runs).toBe(18);
    expect(r.estimate).toBeCloseTo(14 / 18, 12);
    expect(r.designEffect).toBeCloseTo(designEffect(18 / 5, 0.5), 12);
    expect(r.effectiveRuns).toBeCloseTo(18 / r.designEffect, 12);
    const n = Math.round(r.effectiveRuns);
    const w = wilson(Math.round((14 / 18) * n), n);
    expect(r.lower).toBeCloseTo(w.lower, 12);
    expect(r.upper).toBeCloseTo(w.upper, 12);
  });
  it('is the plain Wilson interval when every session holds one run', () => {
    const r = sessionRate(runs([1, 1, 1, 1], [1, 1, 0, 1]), { rho: 0.4 });
    expect(r.designEffect).toBe(1);
    expect(r.lower).toBeCloseTo(wilson(3, 4).lower, 12);
  });
  it('widens as rho grows', () => {
    const a = sessionRate(runs([4, 4, 4], [4, 2, 3]), { rho: 0 });
    const b = sessionRate(runs([4, 4, 4], [4, 2, 3]), { rho: 0.8 });
    expect(b.upper - b.lower).toBeGreaterThan(a.upper - a.lower);
  });
  it('throws a RangeError on a rho outside [0, 1] and on no runs', () => {
    const two = [
      { session: 'a', pass: true },
      { session: 'a', pass: false },
    ];
    expect(() => sessionRate(two, { rho: -0.2 })).toThrow(/rho/);
    expect(() => sessionRate(two, { rho: 1.5 })).toThrow(RangeError);
    expect(() => sessionRate([], { rho: 0.3 })).toThrow(RangeError);
  });
});
