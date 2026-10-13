import { describe, expect, it } from 'vitest';
import { runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

// The span id of the coverage.check call in the OpenTelemetry semantic-conventions fixture.
const SPAN = 'a100000000000003';

describe('a timeline event that carries a trace span id is anchored by that span', () => {
  it('uses the span id as the anchor id, and falls back to the position when there is none', () => {
    const base = run({ blocks: [{ text: 'hi' }] });
    const withSpan = {
      ...base,
      events: [
        {
          type: 'tool_call' as const,
          index: 0,
          label: 'coverage.check',
          spanId: SPAN,
          at: '2026-03-02T10:00:01Z',
        },
        { type: 'tool_call' as const, index: 0, label: 'port.check', at: '2026-03-02T10:00:02Z' },
      ],
    };
    const detail = runDetailOf(dataOf([withSpan]), withSpan);
    expect(detail.blocks[0]?.timelineEvents).toEqual([
      { id: SPAN, label: 'tool coverage.check' },
      { id: 'event:1', label: 'tool port.check' },
    ]);
  });
});
