import { hierarchicalBetaBinomial, mde, wilson, wilsonEffective } from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { PLANNING_POWER } from '../src/compare';
import { clustered } from '../src/estimate';
import { headlineNote } from '../src/format';
import { HEADLINE_POWER, suiteHeadline } from '../src/headline';
import { headlineText } from '../src/text';
import { run } from './support';

/** `passes` of `total` repeats of one golden pass; the others fail at block 1. */
function golden(specId: string, total: number, passes: number) {
  return Array.from({ length: total }, (_, repeat) =>
    run({ specId, repeat, blocks: repeat < passes ? [{}, {}] : [{}, { pass: false }] }),
  );
}
const treeOf = (r: { specId: string }) => r.specId;

describe('suiteHeadline', () => {
  const runs = [
    ...golden('a', 5, 5),
    ...golden('b', 5, 5),
    ...golden('c', 5, 4),
    ...golden('d', 5, 0),
    ...golden('e', 5, 2),
    ...golden('f', 2, 2),
  ];
  const h = suiteHeadline(runs, treeOf);

  it('is the mean over goldens with the hierarchical interval of the stats package', () => {
    const counts = [
      { n: 5, k: 5 },
      { n: 5, k: 5 },
      { n: 5, k: 4 },
      { n: 5, k: 0 },
      { n: 5, k: 2 },
      { n: 2, k: 2 },
    ];
    const want = hierarchicalBetaBinomial(counts);
    expect(h?.method).toBe('hierarchical');
    expect(h?.estimate).toBeCloseTo((1 + 1 + 0.8 + 0 + 0.4 + 1) / 6, 12);
    expect(h?.lower).toBe(want.lower);
    expect(h?.upper).toBe(want.upper);
    expect(h?.trees).toBe(6);
    expect(h?.clusters).toBe(6);
    expect(h?.runs).toBe(27);
    expect(h?.n).toBe(27);
  });

  it('weighs every golden the same: the pooled rate is kept apart', () => {
    // 5 + 5 + 4 + 0 + 2 + 2 = 18 passing runs of 27.
    expect(h?.pooledRate).toBeCloseTo(18 / 27, 12);
    expect(h?.estimate).not.toBeCloseTo(h?.pooledRate ?? 0, 3);
  });

  it('prints the design effect, the effective runs and the detectable drop of the same clustering', () => {
    const effective = wilsonEffective([
      { n: 5, k: 5 },
      { n: 5, k: 5 },
      { n: 5, k: 4 },
      { n: 5, k: 0 },
      { n: 5, k: 2 },
      { n: 2, k: 2 },
    ]);
    expect(h?.designEffect).toBe(effective.designEffect);
    expect(h?.effectiveRuns).toBe(effective.effectiveN);
    const drop = mde({ n: effective.effectiveN, baselineRate: h?.estimate ?? 0, power: 0.8 }).effect;
    expect(h?.detectableDrop).toBeCloseTo(drop ?? Number.NaN, 12);
    expect(HEADLINE_POWER).toBe(PLANNING_POWER);
  });

  it('is wider than the Wilson interval that reads every run as independent', () => {
    const naive = wilson(18, 27);
    expect((h?.upper ?? 0) - (h?.lower ?? 0)).toBeGreaterThan(naive.upper - naive.lower);
  });

  it('reports the share of runs without a verdict, and blocked and not run when a run carries them', () => {
    const odd = [
      ...golden('a', 4, 4),
      ...golden('b', 4, 2),
      run({ specId: 'c', status: 'failed' }),
      run({ specId: 'c', repeat: 1 }),
      { ...run({ specId: 'd' }), status: 'blocked' } as unknown as ReturnType<typeof run>,
      { ...run({ specId: 'd', repeat: 1 }), status: 'not_run' } as unknown as ReturnType<typeof run>,
    ];
    const got = suiteHeadline(odd, treeOf);
    expect(got?.shares.incomplete).toBeCloseTo(3 / 12, 12);
    expect(got?.shares.blocked).toBeCloseTo(1 / 12, 12);
    expect(got?.shares.notRun).toBeCloseTo(1 / 12, 12);
    expect(headlineNote(got as NonNullable<typeof got>)).toMatch(
      /25\.0% did not complete, 8\.3% blocked, 8\.3% not run/,
    );
    expect(h?.shares).toEqual({ incomplete: 0, blocked: 0, notRun: 0 });
    expect(headlineNote(h as NonNullable<typeof h>)).not.toMatch(/did not complete|blocked|not run/);
  });

  it('draws no interval for one golden, and says so', () => {
    const one = suiteHeadline(golden('a', 4, 3), treeOf);
    expect(one?.method).toBe('none');
    expect(one?.lower).toBe(one?.estimate);
    expect(one?.upper).toBe(one?.estimate);
    expect(one?.detectableDrop).toBeNull();
    expect(headlineText('F', one as NonNullable<typeof one>)).toContain('no interval: one cluster');
  });

  it('counts each golden once when every run agrees, and says so', () => {
    const all = suiteHeadline([...golden('a', 3, 3), ...golden('b', 3, 3), ...golden('c', 2, 2)], treeOf);
    expect(all?.degenerate).toBe(true);
    expect(all?.effectiveRuns).toBe(3);
    expect(all?.upper).toBe(1);
    expect(headlineNote(all as NonNullable<typeof all>)).toContain(
      'every run agrees, so each golden counts once',
    );
    expect(h?.degenerate).toBe(false);
  });

  it('is undefined with no run', () => {
    expect(suiteHeadline([], treeOf)).toBeUndefined();
  });

  it('prints one line for the command line', () => {
    const line = headlineText('F', h as NonNullable<typeof h>);
    expect(line).toMatch(
      /^Suite pass rate, mode F: 70\.0% \[\d+\.\d%, \d+\.\d%\] \(hierarchical 95% interval\); 6 goldens, n_eff /,
    );
    expect(line).toMatch(/detectable drop \d+\.\d points at 80% power\.$/);
  });
});

describe('the clustered rate carries its design effect', () => {
  it('prints n_eff and the design effect on a `wilson, design effect` estimate', () => {
    const values = [...Array(5).fill(1), ...Array(5).fill(1), ...Array(5).fill(0), 1, 0, 1, 0, 0];
    const clusters = [
      ...Array(5).fill('a'),
      ...Array(5).fill('b'),
      ...Array(5).fill('c'),
      'd',
      'd',
      'e',
      'e',
      'e',
    ];
    const got = clustered(values, clusters, { rate: true });
    expect(got?.method).toBe('wilson, design effect');
    const want = wilsonEffective([
      { n: 5, k: 5 },
      { n: 5, k: 5 },
      { n: 5, k: 0 },
      { n: 2, k: 1 },
      { n: 3, k: 1 },
    ]);
    expect(got?.designEffect).toBe(want.designEffect);
    expect(got?.effectiveN).toBe(want.effectiveN);
    expect(got?.lower).toBe(want.lower);
    expect(got?.upper).toBe(want.upper);
    expect(got?.n).toBe(values.length);
  });

  it('leaves a bootstrap estimate without them', () => {
    const got = clustered([1, 2, 3, 4], ['a', 'a', 'b', 'b']);
    expect(got?.method).toBe('cluster bootstrap');
    expect(got?.designEffect).toBeUndefined();
  });
});
