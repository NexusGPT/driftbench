import { describe, expect, it } from 'vitest';
import { binomialCdf, chiSquareSf, incompleteBeta } from '../src/index';
import { bd0, seriesStepLimit } from '../src/special';
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

describe('binomialCdf across the switch from the sum to the incomplete beta', () => {
  // The sum of n masses carries the logGamma error of each term (1e-11 at n = 5000); the beta form does not.
  const middle = reference.binomialCdf.filter((c) => c.n > 100 && c.n <= 5000);
  it.each(middle)('P(X <= $k), n = $n, p = $p is exact to 1e-12', (c) => {
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(1e-12);
  });
});

describe('the deviance term', () => {
  // x log(x / np) + np - x is a difference of numbers near x log x. Inside the 10 percent window (|x - np| < 0.1 (x + np))
  // the series keeps it to about 1e-16 times its value, where the direct form is wrong by 1e-16 x |x - np| / np in
  // absolute terms, and exp(-bd0) turns that into a relative error of the prefactor.
  const inside = reference.bd0.filter((c) => Math.abs(c.x - c.np) < 0.1 * (c.x + c.np));
  const outside = reference.bd0.filter((c) => Math.abs(c.x - c.np) >= 0.1 * (c.x + c.np));
  it.each(inside)('bd0($x, $np) inside the window is exact to 1e-14 of its value plus 1e-12', (c) => {
    expect(Math.abs(bd0(c.x, c.np) - c.expected)).toBeLessThan(1e-14 * c.expected + 1e-12);
  });
  it.each(outside)('bd0($x, $np) outside the window is exact to 1e-14 relative', (c) => {
    expect(Math.abs(bd0(c.x, c.np) - c.expected)).toBeLessThan(1e-14 * c.expected);
  });
});

describe('the step limit of the series and fractions', () => {
  it('grows with the square root of the shape and stops at 5 million', () => {
    for (const a of [10, 1e3, 1e6, 1e8, 1e10]) {
      expect(seriesStepLimit(a)).toBeGreaterThanOrEqual(10000 + 8 * Math.sqrt(a));
    }
    expect(seriesStepLimit(1e300)).toBe(5_000_000);
    expect(seriesStepLimit(1e12)).toBeLessThanOrEqual(5_000_000);
  });

  it('answers NaN at once for a shape the limit cannot reach, as main did, instead of running for years', () => {
    expect(chiSquareSf(1e300, 1e300)).toBeNaN();
    expect(incompleteBeta(0.5, 1e300, 1e300)).toBeNaN();
    // The unconverged fraction is a finite probability (0.4558) at 1e20, or minus infinity at 1e24, when not caught.
    expect(incompleteBeta(0.5, 1e20, 1e20)).toBeNaN();
    expect(incompleteBeta(0.5, 1e24, 1e24)).toBeNaN();
    expect(binomialCdf(5e299, 1e300, 0.5)).toBeNaN();
  });

  it('keeps a probability between 0 and 1 where the fraction needs millions of terms', () => {
    // n = 1e15: the exact value is 0.5000000126156626; the fraction runs for a few million terms and agrees to 3e-8.
    const got = binomialCdf(5e14, 1e15, 0.5);
    expect(got).toBeGreaterThan(0.5);
    expect(got).toBeLessThan(0.5 + 1e-6);
    expect(Math.abs(got - 0.5000000126156626)).toBeLessThan(5e-8);
  });
});

describe('pins found in review of the large-shape change', () => {
  it.each(reference.binomialCdfMid)('binomialCdf is exact to 2e-13 for n = $n (k = $k, p = $p)', (c) => {
    // The term-by-term sum carries about 2e-12 of logGamma error by n = 2000; the beta form stays under 7e-14. A switch
    // moved above 50 sends these cases through the sum.
    expect(relative(binomialCdf(c.k, c.n, c.p), c.expected)).toBeLessThan(2e-13);
  });

  it('bd0 stays exact where the ratio x / np is large or small (the series would not converge past about 2000)', () => {
    for (const c of reference.bd0.filter((d) => d.x / d.np >= 3 || d.x / d.np <= 0.3)) {
      expect(relative(bd0(c.x, c.np), c.expected), `bd0(${c.x}, ${c.np})`).toBeLessThan(1e-14);
    }
  });

  it('bd0 falls back to a difference of logarithms when x / np underflows to zero', () => {
    // np = 1e305 and x = 1e-20: the ratio is 1e-325 and rounds to 0, whose logarithm is minus infinity. The fallback
    // log x - log np is -702.8 and the result is np to the last digit: np - x + x (log x - log np).
    const got = bd0(1e-20, 1e305);
    expect(Number.isFinite(got)).toBe(true);
    expect(relative(got, 1e305)).toBeLessThan(1e-15);
    // Just inside the bound the ratio still works; the same function must agree across it.
    expect(relative(bd0(1e-10, 1e295), 1e295)).toBeLessThan(1e-15);
  });

  it('bd0 falls back to a difference of logarithms when x / np overflows to infinity', () => {
    // x = 1e300 and np = 1e-20: the ratio is 1e320 and is Infinity. x (ln x - ln np - 1) + np is 7.3586e302.
    const expected = 1e300 * (Math.log(1e300) - Math.log(1e-20) - 1);
    const got = bd0(1e300, 1e-20);
    expect(Number.isFinite(got)).toBe(true);
    expect(relative(got, expected)).toBeLessThan(1e-14);
  });

  it('the gamma series answers NaN, not a partial sum, when it has not converged (x below a + 1, df of 2e12)', () => {
    // Near x = df the series needs about 8 sqrt(a) ~ 8e6 terms and the limit is 5 million.
    expect(chiSquareSf(2e12, 2e12)).toBeNaN();
    expect(chiSquareSf(1.5e12, 1.5e12)).toBeNaN();
    expect(chiSquareSf(1e12, 1e12)).toBeGreaterThan(0.49);
  });

  it('the gamma continued fraction answers NaN when it has not converged (x just above a + 1, df of 2e16)', () => {
    expect(chiSquareSf(2e16 + 2, 2e16)).toBeNaN();
    // The unconverged fraction is a finite number here (0.49999971 for 1e18 + 1e3), which is the failure this branch prevents.
    expect(chiSquareSf(1e18 + 1e3, 1e18)).toBeNaN();
    expect(chiSquareSf(1e18 + 1e6, 1e18)).toBeNaN();
    // A few standard deviations out it converges, and the same df still answers.
    expect(chiSquareSf(2e16 + 1e8, 2e16)).toBeGreaterThan(0.15);
  });

  it('the beta continued fraction answers NaN when it has not converged (shapes of 1e300)', () => {
    expect(incompleteBeta(0.5, 1e300, 1e300)).toBeNaN();
    // The unconverged fraction is a finite probability (0.4558) at 1e20, or minus infinity at 1e24, when not caught.
    expect(incompleteBeta(0.5, 1e20, 1e20)).toBeNaN();
    expect(incompleteBeta(0.5, 1e24, 1e24)).toBeNaN();
    expect(incompleteBeta(0.5, 1e300, 1e290)).toBeNaN();
    expect(incompleteBeta(0.3, 1e290, 1e300)).toBeNaN();
  });
});
