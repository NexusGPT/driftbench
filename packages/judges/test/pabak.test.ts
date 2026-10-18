import { describe, expect, it } from 'vitest';
import { agreement } from '../src/calibration';

describe('agreement: PABAK, the prevalence-adjusted bias-adjusted kappa', () => {
  it('is 2 * agree / n - 1, so it reads the raw agreement with no prevalence correction', () => {
    const result = agreement(
      ['a', 'b', 'c', 'd'],
      ['pass', 'pass', 'fail', 'fail'],
      ['pass', 'fail', 'fail', 'fail'],
    );
    expect(result.agree).toBe(3);
    expect(result.pabak).toBeCloseTo(0.5, 10);
  });

  it('is -1 when no block agrees and 1 when every block agrees', () => {
    expect(agreement(['a', 'b'], ['pass', 'fail'], ['fail', 'pass']).pabak).toBe(-1);
    expect(agreement(['a', 'b'], ['pass', 'fail'], ['pass', 'fail']).pabak).toBe(1);
  });
});
