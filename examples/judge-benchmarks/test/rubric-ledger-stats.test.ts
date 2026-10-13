import { describe, expect, it } from 'vitest';
import { exactMcNemar, pairedStatistics, powerLine } from '../src/rubric-ledger-stats';

describe('RubricBench paired statistics', () => {
  it('matches exact tails and never treats absence of discordance as a win', () => {
    expect(exactMcNemar(0, 0)).toBe(1);
    expect(exactMcNemar(6, 0)).toBeCloseTo(0.03125, 12);
    expect(exactMcNemar(10, 0)).toBeCloseTo(0.001953125, 12);
    expect(exactMcNemar(1, 7)).toBeCloseTo(0.0703125, 12);
    expect(exactMcNemar(500, 500)).toBeCloseTo(1, 12);
    expect(() => exactMcNemar(-1, 2)).toThrow();
  });
  it('retains shared-order dependence in the pair sensitivity', () => {
    const s = pairedStatistics([
      { id: 'a', ours: [true, true], peer: [false, false] },
      { id: 'b', ours: [true, true], peer: [true, false] },
      { id: 'c', ours: [false, false], peer: [true, false] },
    ]);
    expect([s.wins, s.losses, s.bothRight, s.bothWrong]).toEqual([3, 1, 1, 1]);
    expect(s.pairSensitivity).toEqual({ wins: 2, losses: 1, p: 1 });
    expect(s.holmP).toBeNull();
    expect(s.ours.estimate).toBeCloseTo(4 / 6);
    expect(s.peer.estimate).toBeCloseTo(2 / 6);
  });
  it('rejects dropped games and duplicate ids', () => {
    expect(() => pairedStatistics([{ id: 'a', ours: [true], peer: [false] }])).toThrow();
    expect(() => pairedStatistics(Array(2).fill({ id: 'a', ours: [true, true], peer: [false, false] }))).toThrow();
  });
  it('does not promise finite power at zero effect', () => {
    expect(powerLine(4, 4, 100).neededUnits).toBeNull();
    expect(powerLine(49, 19, 483).neededUnits).toBeGreaterThan(400);
  });
});
