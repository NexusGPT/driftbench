import { describe, expect, it } from 'vitest';
import { atomicDecision, atomicPrompt } from '../src/rubric-atomic';

const text = (checks: unknown[], winner = 'B') => JSON.stringify({ checks, winner });
const check = (id: number, a: number, b: number, weight = 1) => ({
  id,
  a,
  b,
  weight,
  evidence: 'literal evidence',
});

describe('atomic rubric scoring', () => {
  it('computes weighted arithmetic independently of the model winner', () => {
    const raw = text([check(1, 2, 0, 3), check(2, 0, 2), check(3, 0, 2)]);
    expect(atomicDecision(raw, 'weighted')).toBe('A');
    expect(atomicDecision(raw, 'equal')).toBe('B');
    expect(atomicDecision(raw, 'holistic')).toBe('B');
  });
  it('distinguishes partial credit and full-credit counts', () => {
    const raw = text([check(1, 2, 1), check(2, 0, 1), check(3, 0, 1)]);
    expect(atomicDecision(raw, 'binary')).toBe('A');
    expect(atomicDecision(raw, 'equal')).toBe('B');
  });
  it('is symmetric when the replies and verdict are swapped', () => {
    const checks = [check(1, 2, 0, 3), check(2, 0, 1)];
    for (const method of ['binary', 'equal', 'weighted', 'holistic'] as const) {
      expect(atomicDecision(text(checks, 'A'), method)).toBe('A');
      expect(
        atomicDecision(
          text(
            checks.map((c) => ({ ...c, a: c.b, b: c.a })),
            'B',
          ),
          method,
        ),
      ).toBe('B');
    }
  });
  it('rejects malformed or missing checks without coercing strings or inventing a winner', () => {
    for (const raw of [
      text([]),
      text([check(2, 2, 0)]),
      text([{ ...check(1, 2, 0), a: '2' }]),
      text([check(1, 2, 0, 4)]),
      text([{ ...check(1, 2, 0), evidence: '' }]),
      text([check(1, 2, 0)], 'invalid'),
    ]) {
      expect(atomicDecision(raw, 'weighted')).toBe('tie');
    }
  });
  it('passes supplied text verbatim as data, with no label, id or domain', () => {
    const p = atomicPrompt({ question: 'Q', a: 'A', b: 'B', criterion: 'R' });
    expect(JSON.parse(p.user)).toEqual({ question: 'Q', rubric: 'R', responses: { A: 'A', B: 'B' } });
  });
});
