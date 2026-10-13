import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { stageModel, thenOf } from '../../src/estate/then';

const guard: EstateAtom = {
  id: 'guard.sample.reply',
  kind: 'guard',
  title: 'Reply guard',
  approved: true,
  evidence: [{ type: 'guard', name: 'reply-check' }],
};
const context = { stages: stageModel([]), skills: new Set<string>(), customChecks: new Set<string>() };

describe('negative guard controls distinguish an invocation from an intervention', () => {
  it('forbids intervention verdicts without forbidding a normal allow', () => {
    const expected = thenOf([guard], 'negative', context).guards;
    const check = (verdict: string) =>
      expected.every((item) => item.count === 0 && item.verdict !== undefined && item.verdict !== verdict);
    expect(check('allow')).toBe(true);
    for (const verdict of ['deny', 'ask', 'warn', 'nudge']) expect(check(verdict), verdict).toBe(false);
  });

  it('keeps an explicitly declared verdict exact', () => {
    const explicit = {
      ...guard,
      evidence: [{ type: 'guard' as const, name: 'reply-check', verdict: 'review' }],
    };
    expect(thenOf([explicit], 'negative', context).guards).toEqual([
      { name: 'reply-check', verdict: 'review', count: 0 },
    ]);
  });
});
