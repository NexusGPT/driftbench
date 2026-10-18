import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';
import { groundEvidence, groundEvidenceSpan } from '../src/evidence';

// The recorded shape of heldout-goal empty-state items: the persisted order file is an empty object.
const request: JudgeRequest = {
  criterion: { name: 'goal_hard', rubric: 'Only the persisted final order counts.' },
  transcript: [
    { role: 'user', text: 'Create a confirmed order.' },
    { role: 'agent', text: 'I have successfully completed your order.' },
  ],
  inputs: [{ path: 'persisted-final-order.json', text: '{}' }],
};
const source = 'input.persisted-final-order.json';
const ledger = (quote: string, met: boolean) =>
  JSON.stringify({
    checks: [
      {
        id: 'goal_hard',
        reasoning: 'The persisted order file is an empty object.',
        evidence: [
          { source: 'transcript.1', quote: 'I have successfully completed your order.' },
          { source, quote },
        ],
        met,
      },
    ],
  });

describe('a quote that is the whole text of an empty JSON source', () => {
  it('grounds an exact copy of an empty object or array in its named source', () => {
    expect(groundEvidenceSpan(request, { source, quote: '{}' })).toEqual({ grounded: true, where: source });
    expect(groundEvidenceSpan(request, { source, quote: '{ }' }).grounded).toBe(true);
    const list = { ...request, inputs: [{ path: 'persisted-final-order.json', text: '[]\n' }] };
    expect(groundEvidenceSpan(list, { source, quote: '[]' }).grounded).toBe(true);
    // The sole declared input keeps its bare-path alias.
    expect(groundEvidenceSpan(request, { source: 'persisted-final-order.json', quote: '{}' })).toEqual({
      grounded: true,
      where: source,
    });
  });
  it('decodes the recorded met false ledger to fail instead of an invalid ledger', () => {
    const result = parseJudgeText(ledger('{}', false), request);
    expect(result.unparsed).toBeUndefined();
    expect(result.answer.outcome).toBe('fail');
  });
  it('grounds it in a transcript entry or data place whose whole text it is', () => {
    const tool: JudgeRequest = {
      criterion: request.criterion,
      transcript: [...request.transcript, { role: 'tool_result', tool: 'order.persisted', text: '{}' }],
    };
    const answer = { outcome: 'fail' as const, reasoning: '', evidence: '{}' };
    expect(groundEvidence(tool, answer)).toEqual({ grounded: true, where: 'transcript.2' });
    expect(groundEvidenceSpan(tool, { source: 'transcript.2', quote: '{}' }).grounded).toBe(true);
    expect(groundEvidence({ ...request, artifact: '{}', inputs: [] }, answer)).toEqual({
      grounded: true,
      where: 'artifact',
    });
  });
  it('never grounds it in a source that holds anything else', () => {
    for (const text of ['{"status":"confirmed"}', 'The order is {}.', '[]', '""', '', '...', '{', '{}{}']) {
      const other = { ...request, inputs: [{ path: 'persisted-final-order.json', text }] };
      expect(groundEvidenceSpan(other, { source, quote: '{}' }).grounded).toBe(false);
      expect(parseJudgeText(ledger('{}', false), other).unparsed).toBe(true);
    }
    expect(groundEvidenceSpan(request, { source: 'transcript.1', quote: '{}' }).grounded).toBe(false);
    expect(groundEvidenceSpan(request, { source: 'input.missing.json', quote: '{}' }).grounded).toBe(false);
  });
  it('keeps decoration-only quotes ungrounded even when they equal the whole source', () => {
    for (const text of ['""', "''", '...', '…', '**', '`', '## ', '- ', '}', '] ) ) ]', '(){}']) {
      const same = { ...request, inputs: [{ path: 'persisted-final-order.json', text }] };
      expect(groundEvidenceSpan(same, { source, quote: text }).grounded).toBe(false);
      expect(
        groundEvidence(
          { criterion: request.criterion, transcript: [{ role: 'agent', text }] },
          { outcome: 'pass', reasoning: '', evidence: text },
        ).grounded,
      ).toBe(false);
    }
  });
});
