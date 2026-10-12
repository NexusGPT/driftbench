import { describe, expect, it } from 'vitest';
import { renderRun } from '../src/html';
import { runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

const events = [
  { type: 'block_start', index: 0, at: '2026-10-12T09:00:00.000Z' },
  {
    type: 'model_call',
    index: 0,
    inputTokens: 120,
    outputTokens: 40,
    usd: 0.0021,
    latencyMs: 640,
    startedAt: '2026-10-12T09:00:00.100Z',
    at: '2026-10-12T09:00:00.740Z',
  },
  { type: 'tool_call', index: 0, label: 'coverage.check', at: '2026-10-12T09:00:00.800Z' },
  { type: 'block_end', index: 0, pass: true, at: '2026-10-12T09:00:01.000Z' },
  { type: 'run_end', status: 'completed', at: '2026-10-12T09:00:01.100Z' },
] as const;

describe('the run page shows the run timeline in order, script-free', () => {
  const stored = { ...run({ repeat: 0, blocks: [{}] }), events: [...events] };

  it('lists each event in order with its time and, for a model call, its start, end, tokens and cost', () => {
    const html = renderRun(runDetailOf(dataOf([stored]), stored));
    expect(html).toContain('Timeline');
    const order = ['block_start', 'model_call', 'tool_call', 'block_end', 'run_end'].map((name) =>
      html.indexOf(name),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('120 in');
    expect(html).toContain('40 out');
    expect(html).toContain('0.0021 USD');
    expect(html).toContain('640 ms');
    expect(html).toContain('2026-10-12T09:00:00.100Z');
  });

  it('adds no script, so the timeline reads with scripts off', () => {
    const html = renderRun(runDetailOf(dataOf([stored]), stored));
    expect(html).not.toMatch(/<script/i);
  });

  it('says so when the run kept no events', () => {
    const bare = run({ repeat: 0, blocks: [{}] });
    const html = renderRun(runDetailOf(dataOf([bare]), bare));
    expect(html).toContain('No events were recorded for this run.');
  });
});
