/** Repros of the independent re-review of the not_run verdict: no unsent block reads as a failure. */
import { expect, it } from 'vitest';
import { run } from '../../report/test/support';
import { findingOf, violationDetail } from '../src/attack';

it('unsent attack is not an agent violation', () => {
  const r = run({ mode: 'P', perturbationId: 'x', blocks: [{ injected: true, blockId: 'x' }] });
  r.blocks[0] = {
    ...r.blocks[0]!,
    status: 'not_run',
    pass: false,
    notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'x', got: 'false' },
  };
  const p = { id: 'x', recovery: { within_blocks: 1 } } as any;
  expect(findingOf(r, p)).toBe('not measured');
  expect(violationDetail(r, p)).toBeUndefined();
});

it('stored recovery label cannot make an unsent attack a finding', () => {
  const r = run({
    mode: 'P',
    perturbationId: 'x',
    blocks: [{ injected: true, blockId: 'x' }],
    recovery: { injectedAt: 0, label: 'never', collateral: 0 },
  });
  r.blocks[0] = {
    ...r.blocks[0]!,
    status: 'not_run',
    pass: false,
    notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'x', got: 'false' },
  };
  expect(findingOf(r, { id: 'x', recovery: { within_blocks: 1 } } as any)).toBe('not measured');
});
