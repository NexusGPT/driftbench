import { describe, expect, it } from 'vitest';
import { agreement } from '../src/calibration';

describe('agreement metrics', () => {
  it('counts the confusion matrix with fail as the positive class, inconclusive as wrong', () => {
    const r = agreement(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['fail', 'fail', 'fail', 'pass', 'pass', 'pass'],
      ['fail', 'fail', 'inconclusive', 'pass', 'fail', 'inconclusive'],
    );
    expect(r.metrics).toMatchObject({ tp: 2, fn: 1, tn: 1, fp: 2 });
    expect(r.metrics.sensitivity).toBeCloseTo(2 / 3);
    expect(r.metrics.specificity).toBeCloseTo(1 / 3);
    expect(r.metrics.balancedAccuracy).toBeCloseTo(0.5);
    expect(r.metrics.falsePositiveRate).toBeCloseTo(2 / 3);
    expect(r.metrics.falseNegativeRate).toBeCloseTo(1 / 3);
  });

  it('leaves a rate out when its class has no label', () => {
    const r = agreement(['a'], ['pass'], ['pass']);
    expect(r.metrics.sensitivity).toBeUndefined();
    expect(r.metrics.specificity).toBe(1);
    expect(r.metrics.balancedAccuracy).toBeUndefined();
  });
});
