import { expect, it } from 'vitest';
import { writingAccuracy, writingInterval } from '../src/wp-final-analysis';

it('scores ties as wrong and keeps correlated order games in their question cluster', () => {
  const rows = [
    { id: 'one', rowKey: '1', group: 'en', label: 'A' as const, games: ['A', 'A'] },
    { id: 'one', rowKey: '2', group: 'en', label: 'A' as const, games: ['tie', 'B'] },
    { id: 'two', rowKey: '3', group: 'en', label: 'A' as const, games: ['B', 'B'] },
    { id: 'three', rowKey: '4', group: 'zh', label: 'B' as const, games: ['B', 'B'] },
  ];
  expect(writingAccuracy(rows)).toEqual({ items: 4, games: 8, correct: 4, accuracy: 0.5 });
  const ci = writingInterval(rows, 1000);
  expect(ci.clusters).toBe(3);
  expect(ci.lower).toBeLessThanOrEqual(0.5);
  expect(ci.upper).toBeGreaterThanOrEqual(0.5);
  expect(writingInterval(rows, 1000)).toEqual(ci);
});
