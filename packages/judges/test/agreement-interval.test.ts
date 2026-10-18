import { describe, expect, it } from 'vitest';
import { agreementInterval } from '../src/calibration';

describe('agreementInterval: an exact 95% interval on the share of blocks judges agree on', () => {
  it('gives the Clopper-Pearson bounds at the edges', () => {
    const all = agreementInterval(5, 5);
    expect(all.upper).toBe(1);
    expect(all.lower).toBeCloseTo(0.025 ** (1 / 5), 3);
    const none = agreementInterval(0, 5);
    expect(none.lower).toBe(0);
    expect(none.upper).toBeCloseTo(1 - 0.025 ** (1 / 5), 3);
  });

  it('contains the observed share and stays inside [0, 1]', () => {
    const { lower, upper } = agreementInterval(12, 20);
    expect(lower).toBeGreaterThan(0.3);
    expect(upper).toBeLessThan(0.85);
    expect(lower).toBeLessThanOrEqual(0.6);
    expect(upper).toBeGreaterThanOrEqual(0.6);
  });
});
