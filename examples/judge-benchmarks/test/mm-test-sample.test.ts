import { describe, expect, it } from 'vitest';
import { interleavedSample, stratifiedInterval } from '../experiments/mm-test-sample';
import { type PairResult, scorePairs } from '../src/score';

function row(group: string, correct: boolean): PairResult {
  return {
    item: {
      kind: 'pair',
      id: group,
      group,
      language: 'en',
      label: 'A',
      question: 'Question',
      a: 'First',
      b: 'Second',
    },
    games: correct ? ['A', 'A'] : ['B', 'B'],
    missing: 0,
  };
}
describe('test sample uncertainty', () => {
  it('keeps the declared proportional cohort while every subset starts early', () => {
    const groups = ['reasoning', 'chat', 'linguistics', 'language mixing', 'safety'];
    const population = groups.flatMap((group, index) =>
      Array.from({ length: index + 4 }, (_, i) => ({ ...row(group, true).item, id: `${group}-${i}` })),
    );
    const selected = interleavedSample(population, population.length, 'fixed-order-seed');
    expect(new Set(selected.map((i) => i.id))).toEqual(new Set(population.map((i) => i.id)));
    expect(selected.slice(0, 5).map((i) => i.group)).toEqual(groups);
    expect(interleavedSample(population, population.length, 'fixed-order-seed')).toEqual(selected);
  });
  it('scores provider-unavailable payloads as wrong while preserving legitimate ties', () => {
    const failed = { ...row('safety', true), providerRefused: true };
    const tied = { ...row('safety', true), games: ['tie', 'tie'] as const };
    expect(scorePairs('mmeval', [failed]).value.estimate).toBe(0);
    expect(scorePairs('mmeval', [tied]).value.estimate).toBe(0.5);
    expect(stratifiedInterval([failed], 1000).upper).toBe(0);
  });
  it('resamples pairs within subsets and preserves equal subset weighting', () => {
    const rows = [...Array.from({ length: 20 }, () => row('large', true)), row('small', false)];
    const interval = stratifiedInterval(rows, 1000);
    expect(interval.lower).toBe(0.5);
    expect(interval.upper).toBe(0.5);
    expect(interval.level).toBe(0.95);
  });
  it('reports nonzero uncertainty for mixed pair outcomes and is reproducible', () => {
    const rows = [row('chat', true), row('chat', false), row('safety', true), row('safety', false)];
    const first = stratifiedInterval(rows, 1000);
    expect(first.lower).toBeLessThan(0.5);
    expect(first.upper).toBeGreaterThan(0.5);
    expect(stratifiedInterval(rows, 1000)).toEqual(first);
    expect(() => stratifiedInterval([], 1000)).toThrow();
  });
});
