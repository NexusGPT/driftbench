import { describe, expect, it } from 'vitest';
import { binomialCdf, chiSquareSf, incompleteBeta } from '../src/index';
import reference from './reference/prefactor.json';

const relative = (got: number, expected: number): number => Math.abs(got - expected) / Math.abs(expected);

describe('incompleteBeta at large shape', () => {
  it.each(reference.incompleteBeta)('I($x; $a, $b) matches the 50-digit sum', (c) => {
    expect(relative(incompleteBeta(c.x, c.a, c.b), c.expected)).toBeLessThan(1e-11);
  });

  it('keeps the measured example: I(0.49966458981176026; 1e7, 1e7) = 0.0013498970344633411', () => {
    expect(relative(incompleteBeta(0.49966458981176026, 1e7, 1e7), 0.0013498970344633411)).toBeLessThan(
      1e-11,
    );
  });
});

describe('chiSquareSf at large degrees of freedom', () => {
  it.each(reference.chiSquareSf)('chi2.sf($x, $df) matches the 50-digit sum', (c) => {
    expect(relative(chiSquareSf(c.x, c.df), c.expected)).toBeLessThan(1e-11);
  });
});

describe('binomialCdf at large n', () => {
  it.each(reference.binomialCdf)('P(X <= $k), n = $n, p = $p matches the 50-digit sum', (c) => {
    // 1 - p is rounded once; at n = 1e7 that moves the answer by up to 3e-12.
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(5e-11);
  });

  it.each(reference.binomialCdfGiant)('answers n = 1e9 without summing k terms (k = $k)', (c) => {
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(5e-11);
  });

  it('is monotone in k across the switch from the sum to the beta form at n = 50', () => {
    for (const n of [50, 51]) {
      let last = 0;
      for (let k = 0; k <= n; k += 1) {
        const v = binomialCdf(k, n, 0.37);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
      expect(last).toBe(1);
    }
    // The two forms agree where they meet.
    expect(
      relative(
        binomialCdf(18, 51, 0.37),
        binomialCdf(18, 50, 0.37) * (1 - 0.37) + binomialCdf(17, 50, 0.37) * 0.37,
      ),
    ).toBeLessThan(1e-13);
  });

  it('keeps the sum for small n exactly: n = 10, p = 0.5, k = 4 is 386 / 1024', () => {
    expect(binomialCdf(4, 10, 0.5)).toBeCloseTo(386 / 1024, 15);
  });
});
