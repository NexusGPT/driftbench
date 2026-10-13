import { describe, expect, it } from 'vitest';
import type { JudgeClient } from '../../../packages/judges/src/index';
import { jevSeats, pairCouncil, pairRequest, recordedSeat, type Side, sideOf } from '../council-pairs';

const PAIR = { id: 'p1', question: 'What is 2 plus 2?', a: '4', b: '5', criterion: 'The answer is correct.' };
const request = { ...pairRequest(PAIR), given: { ledger: { item: 'p1' } } };

function fakeJev(probabilityAFirst: number, probabilityBFirst: number): JudgeClient {
  return {
    id: 'jev',
    family: 'jev',
    cls: 'system1',
    cost: 1,
    async judge(req) {
      const aFirst = req.transcript[1]?.text.endsWith('4') ?? false;
      const p = aFirst ? probabilityAFirst : probabilityBFirst;
      return { answer: { outcome: p >= 0.5 ? 'pass' : 'fail', score: p, reasoning: 'fake' } };
    },
  };
}
const seats = (sides: Side[]) =>
  sides.map((side, i) =>
    recordedSeat(`s${i}`, ['anthropic', 'openai', 'google'][i]!, new Map([['p1', side]])),
  );

describe('the pair council', () => {
  it('takes the System 2 majority when two chat seats agree, and never asks Jev', async () => {
    let asked = 0;
    const jev = fakeJev(0.9, 0.1);
    const counting: JudgeClient = {
      ...jev,
      judge: (r) => {
        asked += 1;
        return jev.judge(r);
      },
    };
    const council = pairCouncil(seats(['A', 'A', 'B']), jevSeats(new Map([['p1', PAIR]]), counting));
    const result = await council.judge(request);
    expect(sideOf(result)).toBe('A');
    expect(result.split).toBe(false);
    expect(asked).toBe(0);
  });

  it('sends a split to System 1, which decides with the swapped order inverted', async () => {
    // Jev prefers response 4 in both orders: A first yes (0.9), B first (5 shown as A) no (0.1).
    const council = pairCouncil(
      seats(['A', 'B', 'tie']),
      jevSeats(new Map([['p1', PAIR]]), fakeJev(0.9, 0.1)),
    );
    const result = await council.judge(request);
    expect(result.split).toBe(true);
    expect(result.cls).toBe('system1');
    expect(sideOf(result)).toBe('A');
  });

  it('lets a position-biased Jev lean to its first-order answer: two of the three seats show A first', async () => {
    const council = pairCouncil(
      seats(['A', 'B', 'missing']),
      jevSeats(new Map([['p1', PAIR]]), fakeJev(0.9, 0.9)),
    );
    const result = await council.judge(request);
    // jev-ab and jev-ab-prefer say A; jev-ba inverted says B: A wins two to one.
    expect(sideOf(result)).toBe('A');
    const biased = pairCouncil(
      seats(['A', 'B', 'missing']),
      jevSeats(new Map([['p1', PAIR]]), fakeJev(0.1, 0.1)),
    );
    expect(sideOf(await biased.judge(request))).toBe('B');
  });

  it('puts the two responses in the data, never in the rubric', () => {
    const r = pairRequest(PAIR, true);
    expect(r.criterion.rubric).not.toContain('5');
    expect(r.transcript[1]?.text).toBe('Response A:\n5');
  });
});
