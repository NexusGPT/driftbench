import { describe, expect, it } from 'vitest';
import { primaryScore } from '../../../../examples/variables/conditions/primary-score';

const known = new Set(['delay/late', 'delay/on_time']);
const existing = [{ id: 's', kind: 'existing' as const, conditions: [{ variable: 'delay', value: 'late' }] }];
const fresh = [{ id: 's', kind: 'new' as const, conditions: [{ variable: 'delay', value: 'NEW' }] }];

describe('the pre-registered primary planted-condition rule', () => {
  it('requires the exact value id for existing conditions', () => {
    expect(
      primaryScore(existing, [{ span: 's', status: 'matched', values: ['delay/on_time'] }], known),
    ).toMatchObject({
      correct: 0,
      assigned: 1,
      planted: 1,
    });
    expect(
      primaryScore(existing, [{ span: 's', status: 'matched', values: ['delay/late'] }], known).correct,
    ).toBe(1);
  });

  it('ignores a proposed new id, while requiring a new proposal under the right variable', () => {
    expect(
      primaryScore(fresh, [{ span: 's', status: 'proposed', values: ['delay/any_valid_id'] }], known).correct,
    ).toBe(1);
    expect(
      primaryScore(fresh, [{ span: 's', status: 'matched', values: ['delay/late'] }], known).correct,
    ).toBe(0);
    expect(
      primaryScore(fresh, [{ span: 's', status: 'matched', values: ['delay/earlier_proposal'] }], known)
        .correct,
    ).toBe(0);
    expect(
      primaryScore(fresh, [{ span: 's', status: 'proposed', values: ['approval/new'] }], known).correct,
    ).toBe(0);
  });

  it('counts every extra assignment and cannot credit one prediction twice', () => {
    const gold = [...existing, { id: 'none', kind: 'none' as const, conditions: [] }];
    const outcomes = [
      { span: 's', status: 'matched', values: ['delay/late', 'delay/on_time'] },
      { span: 'none', status: 'proposed', values: ['delay/invented'] },
    ];
    expect(primaryScore(gold, outcomes, known)).toMatchObject({
      correct: 1,
      assigned: 3,
      planted: 1,
      falsePositives: 2,
      falseNegatives: 0,
    });
    expect(
      primaryScore(
        [
          {
            id: 's',
            kind: 'existing',
            conditions: [
              { variable: 'delay', value: 'late' },
              { variable: 'delay', value: 'late' },
            ],
          },
        ],
        [{ span: 's', status: 'matched', values: ['delay/late'] }],
        known,
      ).correct,
    ).toBe(1);
  });

  it('counts failed and absent spans as misses', () => {
    expect(primaryScore(existing, [{ span: 's', status: 'failed', values: [] }], known)).toMatchObject({
      correct: 0,
      assigned: 0,
      planted: 1,
      falseNegatives: 1,
    });
    expect(primaryScore(existing, [], known).correct).toBe(0);
  });
});
