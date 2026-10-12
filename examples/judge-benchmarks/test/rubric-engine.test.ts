import { describe, expect, it } from 'vitest';
import {
  fixedMajority,
  hardDecision,
  parseRubricPlan,
  parseRubricReply,
  rubricOrder,
} from '../src/rubric-engine';

describe('pointwise rubric engine', () => {
  it('enforces hard items before soft counts', () => {
    const rules = [
      { id: 1, hard: true, weight: 1 },
      { id: 2, hard: false, weight: 3 },
      { id: 3, hard: false, weight: 3 },
    ];
    expect(hardDecision([false, true, true], [true, false, false], rules)).toBe('B');
    expect(hardDecision([true, false, false], [false, true, true], rules)).toBe('A');
    expect(hardDecision([true, true, false], [true, false, false], rules)).toBe('A');
  });
  it('validates classes and weights without coercing strings', () => {
    expect(parseRubricPlan('{"rules":[{"id":1,"hard":true,"weight":3}]}', 1)).toEqual([
      { id: 1, hard: true, weight: 3 },
    ]);
    expect(parseRubricPlan('{"rules":[{"id":1,"hard":"true","weight":3}]}', 1)).toBeUndefined();
    expect(parseRubricPlan('{"rules":[]}', 1)).toBeUndefined();
  });
  it('restores original ids after permutations and denies fabricated positive quotes', () => {
    const raw = JSON.stringify({
      checks: [
        { id: 2, yes: true, quote: 'absent quote' },
        { id: 1, yes: true, quote: 'actual text' },
      ],
    });
    expect(parseRubricReply(raw, 2, 'some actual text here')).toEqual([true, false]);
    expect(parseRubricReply('{"checks":[{"id":1,"yes":true,"quote":""}]}', 1, 'reply')).toEqual([false]);
    expect(
      parseRubricReply('{"checks":[{"id":1,"yes":"true","quote":"reply"}]}', 1, 'reply'),
    ).toBeUndefined();
  });
  it('makes seeded rubric permutations reproducible and complete', () => {
    const rubrics = ['one', 'two', 'three', 'four', 'five', 'six'];
    expect(rubricOrder('q', rubrics, 0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rubricOrder('q', rubrics, 1)).toEqual(rubricOrder('q', rubrics, 1));
    expect([...rubricOrder('q', rubrics, 1)].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rubricOrder('q', rubrics, 1)).not.toEqual(rubricOrder('q', rubrics, 2));
  });
  it('stops only when the unseen fifth-vote outcomes cannot change any Boolean majority', () => {
    expect(
      fixedMajority(
        [
          [true, false],
          [true, false],
        ],
        2,
        5,
      ),
    ).toBeUndefined();
    expect(
      fixedMajority(
        [
          [true, false],
          [true, false],
          [true, false],
        ],
        2,
        5,
      ),
    ).toEqual([true, false]);
    expect(
      fixedMajority(
        [
          [true, false],
          [false, false],
          [true, true],
        ],
        2,
        5,
      ),
    ).toBeUndefined();
    expect(
      fixedMajority(
        [
          [true, false],
          [false, false],
          [true, true],
          [true, false],
        ],
        2,
        5,
      ),
    ).toEqual([true, false]);
  });
});
