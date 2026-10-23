import { describe, expect, it } from 'vitest';
import { checkOutcome, noneRan, runCheck } from '../src/index';

describe('check outcomes with coverage', () => {
  it('returns not-run with the missing capability and never calls the body', () => {
    let called = false;
    const outcome = runCheck({ id: 'live', requires: ['execution', 'guards'] }, new Set(['guards']), () => {
      called = true;
      return { read: 1, findings: [] };
    });
    expect(called).toBe(false);
    expect(outcome).toEqual({
      check: 'live',
      status: 'not-run',
      coverage: { read: 0, skipped: [], missing: ['execution'] },
      findings: [],
      notRun: 'missing-capability',
    });
  });

  it('is not-run over zero inputs, pass over inputs with no finding, fail on a finding', () => {
    expect(checkOutcome('a', { read: 0, findings: [] })).toMatchObject({
      status: 'not-run',
      notRun: 'no-input',
    });
    expect(checkOutcome('a', { read: 3, findings: [] })).toMatchObject({ status: 'pass' });
    expect(checkOutcome('a', { read: 3, findings: ['x'] })).toMatchObject({
      status: 'fail',
      findings: ['x'],
    });
    const skipped = [{ what: 'big.md', reason: 'too-large' }];
    expect(checkOutcome('a', { read: 2, skipped, findings: [] }).coverage.skipped).toEqual(skipped);
  });

  it('says none ran only when every outcome is not-run', () => {
    expect(noneRan([checkOutcome('a', { read: 0, findings: [] })])).toBe(true);
    expect(
      noneRan([checkOutcome('a', { read: 0, findings: [] }), checkOutcome('b', { read: 1, findings: [] })]),
    ).toBe(false);
  });
});
