import { expect, test } from 'vitest';
import { kappa } from '../src/rubric-ledger-report';

test('kappa rejects degenerate perfect single-class fixtures as unmeasurable', () => {
  expect(kappa([{ label: 'A', decision: 'A' }, { label: 'A', decision: 'A' }])).toBeNull();
  expect(kappa([{ label: 'A', decision: 'A' }, { label: 'B', decision: 'B' }])).toBe(1);
  expect(kappa([{ label: 'A', decision: 'B' }, { label: 'B', decision: 'A' }])).toBe(-1);
  expect(kappa([{ label: 'A', decision: 'A' }, { label: 'B', decision: 'A' }])).toBe(0);
});
