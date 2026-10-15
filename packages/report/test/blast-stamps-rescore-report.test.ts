// Blast radius of unit F6 on the report: a re-scored block carries a `rejudged` stamp with no criterion. The run
// page and the scorecard page label it without an empty criterion list.
import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { buildScorecard, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

const stamp = {
  fromCampaign: 'acme-full',
  fromRun: 'r0',
  oldSpecHash: 'aaaaaaaaaaaa',
  newSpecHash: 'aaaaaaaaaaaa',
  compatibilityHash: 'c0ffee',
  judgedAt: '2026-10-15T00:00:00.000Z',
};

function rescored(): RunResult {
  const base = run({ specId: 'g01', blocks: [{}, {}] });
  return {
    ...base,
    rejudged: { ...stamp, criteria: [] },
    blocks: base.blocks.map((block) => ({ ...block, rejudged: { ...stamp, criteria: [], judgeCostUsd: 0 } })),
  };
}

describe('blast stamps: a re-scored block on the report pages', () => {
  // BUG: a re-score stamp with no criterion renders as "Re-judged: ; observations from ...", reported to lead
  it.fails('names the re-score without an empty criterion list, on the run page and the scorecard', () => {
    const one = rescored();
    const data = dataOf([one]);
    const pages = [renderRun(runDetailOf(data, one)), renderHtml(buildScorecard(data))];
    for (const page of pages) {
      expect(page).toContain('observations from acme-full');
      expect(page).not.toMatch(/Re-judged: ;/);
    }
  });

  it('still lists the criteria of a re-judged block', () => {
    const one = rescored();
    const judged: RunResult = {
      ...one,
      blocks: one.blocks.map((block) => ({
        ...block,
        rejudged: { ...stamp, criteria: ['price'], judgeCostUsd: 0 },
      })),
    };
    const data = dataOf([judged]);
    expect(renderRun(runDetailOf(data, judged))).toContain('Re-judged: price; observations from acme-full.');
  });
});
