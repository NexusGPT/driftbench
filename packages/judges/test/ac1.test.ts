import { describe, expect, it } from 'vitest';
import { agreement } from '../src/calibration';

describe("agreement: Gwet's AC1 for two categories", () => {
  it('corrects agreement by the chance of the pass category, which a skewed set makes high', () => {
    const result = agreement(
      ['a', 'b', 'c', 'd', 'e'],
      ['pass', 'pass', 'pass', 'pass', 'fail'],
      ['pass', 'pass', 'pass', 'fail', 'fail'],
    );
    expect(result.agree).toBe(4);
    // po = 0.8; pi = (4 + 3) / 10 = 0.7; pe = 2 * 0.7 * 0.3 = 0.42; AC1 = (0.8 - 0.42) / 0.58
    expect(result.ac1).toBeCloseTo(0.38 / 0.58, 10);
  });

  it('is 1 when every label and every judgement is the same category', () => {
    expect(agreement(['a', 'b'], ['pass', 'pass'], ['pass', 'pass']).ac1).toBe(1);
  });
});
