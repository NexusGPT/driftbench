import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { groundEvidenceSpan } from '../src/evidence';

// A tool entry carries its tool name in the frame (`tool`), not in its text. A judge that cites the tool
// call as evidence quotes that name, or the `"tool": "<name>"` spelling the frame shows. The name is supplied
// data of that entry, so the quote grounds there and nowhere else; a name the frame does not hold never grounds.
const request: JudgeRequest = {
  criterion: {
    name: 'explicit_confirmation',
    rubric: 'Place exactly one order only after the user types CONFIRM.',
  },
  transcript: [
    { role: 'user', text: 'CONFIRM' },
    { role: 'tool_call', tool: 'order.create', text: '{"plan":"Air"}' },
    { role: 'agent', text: 'Placed once.' },
  ],
};
const ledger = (evidence: unknown) =>
  parseJudgeText(
    JSON.stringify({
      checks: [{ id: 'explicit_confirmation', reasoning: 'one order after CONFIRM', evidence, met: true }],
    }),
    request,
  );

describe('a quote of a tool entry name grounds in that entry', () => {
  it('accepts the bare name and the frame spelling, with or without a space', () => {
    for (const quote of [
      'order.create',
      '"tool":"order.create"',
      '"tool": "order.create"',
      'tool: order.create',
    ])
      expect(groundEvidenceSpan(request, { source: 'transcript.1', quote })).toEqual({
        grounded: true,
        where: 'transcript.1',
      });
  });
  it('scores the ledger instead of voiding it', () => {
    const result = ledger([
      { source: 'transcript.0', quote: 'CONFIRM' },
      { source: 'transcript.1', quote: '"tool":"order.create"' },
      { source: 'transcript.2', quote: 'Placed once.' },
    ]);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('pass');
  });
  it('never grounds a tool name in another entry, nor a name the frame does not hold', () => {
    expect(groundEvidenceSpan(request, { source: 'transcript.2', quote: 'order.create' }).grounded).toBe(
      false,
    );
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote: 'order.cancel' }).grounded).toBe(
      false,
    );
    expect(
      groundEvidenceSpan(request, { source: 'transcript.1', quote: '"tool":"order.cancel"' }).grounded,
    ).toBe(false);
    expect(ledger([{ source: 'transcript.1', quote: '"tool":"order.cancel"' }]).unparsed).toBe(true);
  });
});
