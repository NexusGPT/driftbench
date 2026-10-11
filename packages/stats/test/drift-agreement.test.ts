import { describe, expect, it } from 'vitest';
import { cohenKappa, cusum, krippendorffAlpha, ksTest, pageHinkley } from '../src/index';
import { fixtures, near, nearAll } from './support';

describe('cusum', () => {
  it('matches the tabular CUSUM recursion of the reference', () => {
    for (const c of fixtures.drift.cusum) {
      const r = cusum(c.series, c.options);
      near(r.target, c.target, `${c.name} target`);
      near(r.sd, c.sd, `${c.name} sd`);
      nearAll(r.upper, c.upper, `${c.name} upper`);
      nearAll(r.lower, c.lower, `${c.name} lower`);
      expect(r.alarms).toEqual(c.alarms);
    }
  });
  it('fires down after the pass rate drops and stays quiet before it', () => {
    const c = fixtures.drift.cusum[0];
    const r = cusum(c?.series ?? []);
    expect(r.alarms.length).toBeGreaterThan(0);
    expect(r.alarms[0]?.direction).toBe('down');
    expect(r.alarms[0]?.index).toBeGreaterThanOrEqual(40);
  });
  it('refuses a constant warm-up without a given sd', () => {
    expect(() => cusum([1, 1, 1, 1])).toThrow(RangeError);
  });
});

describe('pageHinkley', () => {
  it('matches the reference recursion, alarms included', () => {
    for (const c of fixtures.drift.pageHinkley) {
      const r = pageHinkley(c.series, c.options);
      nearAll(r.up, c.up, `${c.name} up`);
      nearAll(r.down, c.down, `${c.name} down`);
      expect(r.alarms).toEqual(c.alarms);
    }
  });
  it('detects the latency rise in the right direction', () => {
    const c = fixtures.drift.pageHinkley[0];
    const r = pageHinkley(c?.series ?? [], c?.options);
    expect(r.alarms[0]?.direction).toBe('up');
  });
});

describe('ksTest', () => {
  it('matches scipy.stats.ks_2samp(method="exact")', () => {
    for (const c of fixtures.drift.ksTest) {
      const r = ksTest(c.a, c.b);
      expect(r.method).toBe('exact');
      near(r.statistic, c.statistic, `${c.name} D`);
      near(r.pValue, c.pValue, `${c.name} p`);
    }
  });
  it('matches the Kolmogorov limit for the asymptotic method', () => {
    for (const c of fixtures.drift.ksTest) {
      near(ksTest(c.a, c.b, { method: 'asymptotic' }).pValue, c.asymptoticPValue, `${c.name} asymptotic p`);
    }
  });
  it('returns D = 0 and p = 1 for the same sample', () => {
    const r = ksTest([1, 2, 3], [3, 2, 1]);
    expect(r.statistic).toBe(0);
    expect(r.pValue).toBe(1);
  });
});

describe('cohenKappa', () => {
  it('matches the reference for nominal and weighted kappa', () => {
    for (const c of fixtures.kappa) {
      near(cohenKappa(c.a, c.b, { weights: c.weights }).kappa, c.kappa, c.name);
    }
  });
  it('is 1 for perfect agreement and 0 when agreement equals chance', () => {
    expect(cohenKappa(['a', 'b', 'a'], ['a', 'b', 'a']).kappa).toBe(1);
    expect(cohenKappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b']).kappa).toBeCloseTo(0, 12);
  });
});

describe('krippendorffAlpha', () => {
  it('reproduces the published values of the Krippendorff (2011) example to three decimals', () => {
    for (const c of fixtures.krippendorff.filter((x) => x.published !== undefined)) {
      near(
        krippendorffAlpha(c.matrix, { level: c.level }).alpha,
        c.published as number,
        `published ${c.level}`,
        5e-4,
      );
    }
  });
  it('matches the coincidence-matrix reference at every level, missing values included', () => {
    for (const c of fixtures.krippendorff) {
      near(krippendorffAlpha(c.matrix, { level: c.level }).alpha, c.alpha, `${c.name} ${c.level}`);
    }
  });
  it('refuses a numeric level over text labels', () => {
    expect(() =>
      krippendorffAlpha(
        [
          ['a', 'b'],
          ['a', 'c'],
        ],
        { level: 'interval' },
      ),
    ).toThrow(RangeError);
  });
});
