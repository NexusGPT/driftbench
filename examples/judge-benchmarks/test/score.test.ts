import { describe, expect, it } from 'vitest';
import type { PairItem, PointItem } from '../src/data';
import { pairGames, pointGame, scorePairs, scorePoints } from '../src/score';

const pair = (id: string, label: 'A' | 'B', group = 'g'): PairItem => ({
  kind: 'pair',
  id,
  question: 'q',
  a: 'a',
  b: 'b',
  label,
  group,
});

describe('the JudgeBench rule', () => {
  it('counts a pair right only when its two games net in favour of the labelled response', () => {
    const results = [
      { item: pair('1', 'A'), games: pairGames('A', 'B'), missing: 0 }, // both right (B swapped back is A)
      { item: pair('2', 'A'), games: pairGames('A', 'tie'), missing: 0 }, // right and tie: right
      { item: pair('3', 'A'), games: pairGames('A', 'A'), missing: 0 }, // right then wrong: not right
      { item: pair('4', 'A'), games: pairGames('tie', 'tie'), missing: 0 }, // two ties: not right
    ];
    const s = scorePairs('judgebench', results);
    expect(s.value.estimate).toBe(0.5);
    expect(s.positionConsistency).toBe(0.25);
    expect(s.value.lower).toBeGreaterThan(0);
    expect(s.value.upper).toBeLessThan(1);
  });
});

describe('the MM-Eval rule', () => {
  it('scores each game 1, 0 or 0.5 for a tie, averages a pair, then averages the subsets equally', () => {
    const results = [
      { item: pair('1', 'A', 'chat'), games: ['A', 'tie'] as const, missing: 0 }, // 0.75
      { item: pair('2', 'B', 'chat'), games: ['B', 'B'] as const, missing: 0 }, // 1
      { item: pair('3', 'A', 'safety'), games: ['B', 'B'] as const, missing: 0 }, // 0
    ].map((r) => ({ ...r, games: [...r.games] }));
    const s = scorePairs('mmeval', results);
    expect(s.byGroup.chat?.value).toBeCloseTo(0.875, 10);
    expect(s.byGroup.safety?.value).toBe(0);
    expect(s.value.estimate).toBeCloseTo((0.875 + 0) / 2, 10);
  });
});

describe('the LongJudgeBench rules', () => {
  it('wp_bench: accuracy over games, a tie is wrong', () => {
    const s = scorePairs('longjudge-wp', [
      { item: pair('1', 'A'), games: ['A', 'tie'], missing: 0 },
      { item: pair('2', 'B'), games: ['B', 'B'], missing: 0 },
    ]);
    expect(s.value.estimate).toBe(0.75);
  });

  it('verify_bench_hard: accuracy and balanced accuracy, no verdict counts wrong', () => {
    const point = (id: string, correct: boolean): PointItem => ({
      kind: 'point',
      id,
      question: 'q',
      response: 'r',
      correct,
      group: correct ? 'correct' : 'incorrect',
    });
    const s = scorePoints([
      { item: point('1', true), decision: { pass: true }, missing: 0 },
      { item: point('2', false), decision: { pass: false }, missing: 0 },
      { item: point('3', false), decision: { pass: false }, missing: 0 },
      { item: point('4', false), decision: {}, missing: 1 },
    ]);
    expect(s.value.estimate).toBe(0.75);
    expect(s.balancedAccuracy).toBeCloseTo((1 + 2 / 3) / 2, 10);
    expect(s.missing).toBe(1);
  });
});

describe('a pointwise contestant on a pair', () => {
  it('prefers the higher score, falls back to pass, and calls equal or missing scores a tie', () => {
    expect(pointGame({ score: 0.9 }, { score: 0.2 })).toBe('A');
    expect(pointGame({ pass: false }, { pass: true })).toBe('B');
    expect(pointGame({ pass: true }, { pass: true })).toBe('tie');
    expect(pointGame({}, { pass: true })).toBe('tie');
  });
});
