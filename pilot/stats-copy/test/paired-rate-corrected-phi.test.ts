import { describe, expect, it } from 'vitest';
import { pairedRateDifference } from '../src/index';

// Newcombe (1998, method 10) uses the corrected phi: with C = ad - bc, C - n/2 when C > n/2,
// 0 when 0 <= C <= n/2, and C when C < 0, over sqrt((a+b)(c+d)(a+c)(b+d)).
describe('pairedRateDifference corrected phi', () => {
  it('agrees with the interval printed for 10, 0, 0, 10', () => {
    const r = pairedRateDifference({ bothPass: 10, regressed: 0, improved: 0, bothFail: 10 });
    expect(r.estimate).toBe(0);
    expect(r.lower).toBeCloseTo(-0.08975665937768057, 9);
    expect(r.upper).toBeCloseTo(0.08975665937768057, 9);
  });

  it('agrees with the interval printed for 40, 2, 8, 50', () => {
    const r = pairedRateDifference({ bothPass: 40, regressed: 2, improved: 8, bothFail: 50 });
    expect(r.lower).toBeCloseTo(-0.12218275127469713, 9);
    expect(r.upper).toBeCloseTo(0.0035205679987217464, 9);
  });

  it('mirrors when the two versions swap', () => {
    const r = pairedRateDifference({ bothPass: 40, regressed: 2, improved: 8, bothFail: 50 });
    const s = pairedRateDifference({ bothPass: 40, regressed: 8, improved: 2, bothFail: 50 });
    expect(s.lower).toBeCloseTo(-r.upper, 12);
    expect(s.upper).toBeCloseTo(-r.lower, 12);
  });

  it('keeps a negative correlation uncorrected', () => {
    // a d < b c: C < 0, phi = C / sqrt(A) with no shift.
    const r = pairedRateDifference({ bothPass: 2, regressed: 8, improved: 8, bothFail: 2 });
    expect(r.estimate).toBeCloseTo(0, 12);
    expect(r.upper).toBeGreaterThan(0.2);
  });
});
