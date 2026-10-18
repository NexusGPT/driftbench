/** Repros of the independent re-review of the not_run verdict: no unsent block reads as a failure. */
import { expect, it } from 'vitest';
import { renderHtml } from '../src/html';
import { buildScorecard } from '../src/scorecard';
import { dataOf, run } from './support';

it('unsent perturbation with stored label can render HTML', () => {
  const r = run({
    mode: 'P',
    perturbationId: 'x',
    blocks: [{}, { injected: true, blockId: 'x' }],
    recovery: { injectedAt: 1, label: 'never', collateral: 0 },
  });
  r.blocks[1] = {
    ...r.blocks[1]!,
    pass: false,
    status: 'not_run',
    notRun: {
      kind: 'unsupported',
      layer: '5 world',
      check: 'capability',
      expected: 'toolStubs',
      got: 'false',
    },
  };
  const card = buildScorecard(dataOf([r]));
  expect(() => renderHtml(card)).not.toThrow();
});

it('not_run block-end has no failure label in timeline or log', () => {
  const r = run();
  r.blocks[0] = {
    ...r.blocks[0]!,
    pass: false,
    status: 'not_run',
    notRun: { kind: 'unsupported', layer: '5 world', check: 'capability', expected: 'x', got: 'false' },
  };
  r.events = [{ type: 'block_end', index: 0, pass: false, status: 'not_run', at: '2026-10-15T00:00:00Z' }];
  const card = buildScorecard(dataOf([r]));
  expect.soft(card.drilldown[0]?.blocks[0]?.timelineEvents?.[0]?.label).not.toContain('fail');
  expect.soft(renderHtml(card)).not.toContain('block 0 fails');
});
