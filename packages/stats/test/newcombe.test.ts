import { describe, expect, it } from 'vitest';
import { pairedRateDifference } from '../src/paired';
import reference from './reference/newcombe.json';

describe('Newcombe paired hybrid score interval', () => {
  it.each(reference.cases)('matches the independent reference: $name', (c) => {
    const got = pairedRateDifference(c, c.alpha);
    expect(got.estimate).toBeCloseTo(c.estimate, 12);
    expect(got.lower).toBeCloseTo(c.lower, 9);
    expect(got.upper).toBeCloseTo(c.upper, 9);
    expect(got.n).toBe(c.bothPass + c.regressed + c.improved + c.bothFail);
  });

  it.each(reference.cases)('reverses the limits when the arms are swapped: $name', (c) => {
    const got = pairedRateDifference({ ...c, regressed: c.improved, improved: c.regressed }, c.alpha);
    expect(got.estimate).toBeCloseTo(-c.estimate, 12);
    expect(got.lower).toBeCloseTo(-c.upper, 9);
    expect(got.upper).toBeCloseTo(-c.lower, 9);
  });
});
