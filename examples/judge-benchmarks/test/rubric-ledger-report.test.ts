import { expect, test } from 'vitest';
import { kappa, scoreUnblockedIntersection } from '../src/rubric-ledger-report';

test('secondary score removes unilateral and shared blocks from both contestants', () => {
  const rows = [
    { id: 'ledger-block', oursBlocked: true, peerBlocked: false, ours: [false, false], peer: [true, true] },
    { id: 'peer-block', oursBlocked: false, peerBlocked: true, ours: [true, true], peer: [false, false] },
    { id: 'both-block', oursBlocked: true, peerBlocked: true, ours: [false, false], peer: [false, false] },
    { id: 'unblocked', oursBlocked: false, peerBlocked: false, ours: [true, true], peer: [true, false] },
  ];
  expect(scoreUnblockedIntersection(rows)).toMatchObject({ matchedPairs: 1, excludedPairs: 3,
    ledgerOnly: 1, promptfooOnly: 1, both: 1,
    stats: { games: 2, ours: { correct: 2 }, peer: { correct: 1 } } });
  expect(scoreUnblockedIntersection(rows.slice(0, 3))).toMatchObject({ matchedPairs: 0, excludedPairs: 3, stats: null });
});

test('kappa rejects degenerate perfect single-class fixtures as unmeasurable', () => {
  expect(kappa([{ label: 'A', decision: 'A' }, { label: 'A', decision: 'A' }])).toBeNull();
  expect(kappa([{ label: 'A', decision: 'A' }, { label: 'B', decision: 'B' }])).toBe(1);
  expect(kappa([{ label: 'A', decision: 'B' }, { label: 'B', decision: 'A' }])).toBe(-1);
  expect(kappa([{ label: 'A', decision: 'A' }, { label: 'B', decision: 'A' }])).toBe(0);
});
