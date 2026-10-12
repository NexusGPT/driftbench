import { describe, expect, it } from 'vitest';
import { chartRows, renderChart, renderTable } from '../src/chart';
import { spliceResults } from '../src/charts';
import type { RunReport } from '../src/run';

const summary = (estimate: number, pc?: number) => ({
  metric: 'accuracy',
  value: { estimate, lower: estimate - 0.05, upper: estimate + 0.05 },
  n: 100,
  byGroup: {},
  missing: 0,
  ...(pc === undefined ? {} : { positionConsistency: pc }),
});

const report: RunReport = {
  bench: 'judgebench',
  model: 'haiku',
  items: 200,
  contestants: [
    { contestant: 'deepeval', source: '', mode: 'pairwise, both orders', summary: summary(0.8, 0.9), costUsd: 1, calls: 400 },
    { contestant: 'driftbench-adaptive', source: '', mode: 'pairwise, both orders', summary: summary(0.85, 0.95), costUsd: 3, calls: 900 },
    { contestant: 'inspect', source: '', mode: 'pointwise, single game', summary: summary(0.7), costUsd: 0.5, calls: 400 },
  ],
  newSpendUsd: 0,
  newCalls: 0,
  replayed: 1700,
  failedCalls: 0,
};

describe('charts and tables', () => {
  it('ranks by score, marks driftbench and prices per 100 items', () => {
    const rows = chartRows(report, { 'driftbench-adaptive': 'driftbench' });
    expect(rows.map((r) => r.name)).toEqual(['driftbench', 'deepeval', 'inspect']);
    expect(rows[0]?.ours).toBe(true);
    expect(rows[0]?.costPer100).toBeCloseTo(1.5);
    expect(renderChart('T', 'S', rows)).toContain('1.50 USD / 100 items');
  });

  it('writes a ranked table with consistency, cost and missing answers', () => {
    const lines = renderTable(report, { 'driftbench-adaptive': 'driftbench' }).split('\n');
    expect(lines[2]).toBe('| 1 | driftbench | 85.0 [80.0, 90.0] | 95.0 | 1.50 | 0 |');
    expect(lines[4]).toBe('| 3 | inspect | 70.0 [65.0, 75.0] | n/a | 0.25 | 0 |');
  });

  it('replaces only the text between the markers of its model', () => {
    const doc = 'a\n<!-- results-haiku:start -->\nold\n<!-- results-haiku:end -->\nb\n<!-- results-sonnet:start -->\nkeep\n<!-- results-sonnet:end -->\n';
    const out = spliceResults(doc, 'haiku', 'new');
    expect(out).toContain('<!-- results-haiku:start -->\nnew\n<!-- results-haiku:end -->');
    expect(out).toContain('keep');
    expect(out).not.toContain('old');
    expect(() => spliceResults('no markers', 'haiku', 'x')).toThrow(/markers/);
  });
});
