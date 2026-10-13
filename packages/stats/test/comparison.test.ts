import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  mcnemar,
  mde,
  nonInferiority,
  pairedRateDifference,
  passAtK,
  passK,
  unreliability,
  wilcoxonSignedRank,
} from '../src/index';
import { fixtures, near, nearAll } from './support';

describe('passK and passAtK', () => {
  it('pass^k matches C(c, k) / C(n, k) in exact rational arithmetic', () => {
    for (const c of fixtures.reliability.passK)
      near(passK(c.c, c.n, c.k), c.expected, `passK(${c.c}, ${c.n}, ${c.k})`);
  });
  it('pass@k matches 1 - C(n - c, k) / C(n, k) in exact rational arithmetic', () => {
    for (const c of fixtures.reliability.passAtK) {
      near(passAtK(c.c, c.n, c.k), c.expected, `passAtK(${c.c}, ${c.n}, ${c.k})`);
    }
  });
  it('pass^k falls as k grows for an inconsistent agent while pass@k rises', () => {
    expect(passK(8, 10, 1)).toBeGreaterThan(passK(8, 10, 3));
    expect(passAtK(8, 10, 3)).toBeGreaterThan(passAtK(8, 10, 1));
    expect(passK(8, 10, 1)).toBeCloseTo(passAtK(8, 10, 1), 12);
  });
  it('refuses k outside [1, n] and c > n', () => {
    expect(() => passK(3, 10, 11)).toThrow(RangeError);
    expect(() => passAtK(11, 10, 1)).toThrow(RangeError);
  });
});

describe('unreliability', () => {
  it('is the 90th percentile minus the 10th (numpy linear interpolation)', () => {
    for (const c of fixtures.reliability.unreliability) {
      near(unreliability(c.samples), c.expected, `unreliability(${c.samples.length} samples)`);
    }
  });
});

describe('mcnemar', () => {
  it('matches scipy: the exact binomial test below 25 discordant pairs, the corrected chi-square above', () => {
    for (const c of fixtures.mcnemar) {
      const r = mcnemar(c.b, c.c);
      expect(r.method, `mcnemar(${c.b}, ${c.c}) method`).toBe(c.method);
      near(r.statistic, c.statistic, `mcnemar(${c.b}, ${c.c}) statistic`);
      near(r.pValue, c.pValue, `mcnemar(${c.b}, ${c.c}) p`);
    }
  });
  it('can be forced exact for large counts', () => {
    const r = mcnemar(30, 18, { exact: true });
    expect(r.method).toBe('exact');
    expect(r.pValue).toBeGreaterThan(0.05);
  });
});

describe('wilcoxonSignedRank', () => {
  it('matches scipy.stats.wilcoxon with its default method selection', () => {
    for (const c of fixtures.wilcoxon) {
      const r = wilcoxonSignedRank(c.x, c.y);
      near(r.statistic, c.statistic, `${c.name} statistic`);
      near(r.pValue, c.pValue, `${c.name} p (${r.method})`);
    }
  });
  it('picks the method scipy picks', () => {
    const methods = fixtures.wilcoxon.map((c) => wilcoxonSignedRank(c.x, c.y).method);
    expect(methods).toEqual(['exact', 'permutation', 'permutation', 'asymptotic', 'exact', 'asymptotic']);
  });
  it('drops zero differences and returns p = 1 when every pair ties', () => {
    const r = wilcoxonSignedRank([1, 2, 3], [1, 2, 3]);
    expect(r.n).toBe(0);
    expect(r.zeros).toBe(3);
    expect(r.pValue).toBe(1);
  });
});

describe('benjaminiHochberg', () => {
  it('matches scipy.stats.false_discovery_control and rejects where the adjusted p is at most q', () => {
    for (const c of fixtures.benjaminiHochberg) {
      const r = benjaminiHochberg(c.pvalues, c.q);
      nearAll(r.adjusted, c.adjusted, `BH(${c.pvalues.length})`);
      expect(r.rejected).toEqual(c.rejected);
    }
  });
  it('reports the largest rejected raw p-value as the threshold', () => {
    const r = benjaminiHochberg([0.01, 0.04, 0.03, 0.2], 0.05);
    expect(r.threshold).toBe(0.01);
    expect(benjaminiHochberg([0.5, 0.6]).threshold).toBeNull();
  });
});

describe('mde', () => {
  it('matches the two-proportion power equation solved by scipy brentq', () => {
    for (const c of fixtures.mde) {
      const r = mde({
        n: c.n,
        repeats: c.repeats,
        baselineRate: c.baselineRate,
        power: c.power,
        alpha: c.alpha,
        rho: c.rho,
      });
      near(r.effectiveN, c.effectiveN, `mde effectiveN n=${c.n}`);
      if (c.effect === null) expect(r.effect).toBeNull();
      else near(r.effect as number, c.effect, `mde effect n=${c.n} repeats=${c.repeats}`);
    }
  });
  it('shrinks as repeats grow when repeats are independent, and stops shrinking at rho = 1', () => {
    const one = mde({ n: 50, repeats: 1, baselineRate: 0.85 }).effect as number;
    const five = mde({ n: 50, repeats: 5, baselineRate: 0.85 }).effect as number;
    const correlated = mde({ n: 50, repeats: 5, baselineRate: 0.85, rho: 1 }).effect as number;
    expect(five).toBeLessThan(one);
    expect(correlated).toBeCloseTo(one, 9);
  });
  it('returns null when no drop below the baseline rate is detectable', () => {
    expect(mde({ n: 1, baselineRate: 0.05 }).effect).toBeNull();
  });
  it('answers at a baseline where every run passes or every run fails', () => {
    const allPass = mde({ n: 50, baselineRate: 1 }).effect as number;
    expect(allPass).toBeCloseTo(0.142, 3);
    expect(mde({ n: 50, baselineRate: 0 }).effect).toBeNull();
  });
});

describe('pairedRateDifference', () => {
  it("matches Newcombe's method 10 computed from scipy Wilson limits", () => {
    for (const c of fixtures.paired.pairedRateDifference) {
      const r = pairedRateDifference(c, c.alpha);
      const label = `newcombe(${c.bothPass}, ${c.regressed}, ${c.improved}, ${c.bothFail})`;
      near(r.estimate, c.estimate, `${label} estimate`);
      near(r.lower, c.lower, `${label} lower`);
      near(r.upper, c.upper, `${label} upper`);
    }
  });
});

describe('nonInferiority', () => {
  it('gives the parity verdict of the reference for every case', () => {
    for (const c of fixtures.paired.nonInferiority) {
      const r = nonInferiority({
        baseline: c.baseline,
        candidate: c.candidate,
        margin: c.margin,
        ...(c.gatingFlags ? { gatingFlags: c.gatingFlags } : {}),
      });
      expect(r.nonInferior, `${c.name}: ${r.reason}`).toBe(c.nonInferior);
      expect(r.discordant).toEqual({ regressed: c.regressed, improved: c.improved });
      near(r.effect.estimate, c.estimate, `${c.name} estimate`);
      near(r.effect.lower, c.lower, `${c.name} lower`);
      near(r.effect.upper, c.upper, `${c.name} upper`);
    }
  });
  it('does not call zero regressed pairs in a small campaign parity', () => {
    const r = nonInferiority({
      baseline: Array(10).fill(true),
      candidate: Array(10).fill(true),
      margin: 0.05,
    });
    expect(r.discordant.regressed).toBe(0);
    expect(r.nonInferior).toBe(false);
  });
  it('names the pairs that regressed and the new gating flags', () => {
    const r = nonInferiority({
      baseline: [true, true, false, true],
      candidate: [true, false, true, true],
      margin: 0.5,
      pairs: ['a', 'b', 'c', 'd'],
      gatingFlags: { baseline: [false, false, false, true], candidate: [false, false, true, true] },
    });
    expect(r.regressedPairs).toEqual(['b']);
    expect(r.newFlags).toEqual(['c']);
    expect(r.nonInferior).toBe(false);
  });
});
