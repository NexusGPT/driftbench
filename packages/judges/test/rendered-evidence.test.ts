import { describe, expect, it } from 'vitest';
import { groundEvidence, type JudgeRequest, parseJudgeText } from '../src/index';
import fixtures from './fixtures/rendered-evidence-recordings.json';

describe('real Inspect rendered evidence', () => {
  for (const row of fixtures.filter((r) => r.id !== 'qa-negation-2')) {
    it(`${row.id} grounds the recorded role-prefixed quote to its actual entry`, () => {
      const result = parseJudgeText(row.raw, row.request as JudgeRequest);
      expect(result.unparsed).toBeUndefined();
      expect(result.answer.outcome).toBe(row.expected);
      expect(groundEvidence(row.request as JudgeRequest, result.answer)).toEqual({
        grounded: true,
        where: 'transcript.0',
      });
    });
  }
  it('does not ground a wrong role, a role alone, a tool name alone or an invented passage', () => {
    const request: JudgeRequest = {
      criterion: { name: 'c', rubric: 'r' },
      transcript: [
        { role: 'agent', text: 'Actual answer.' },
        { role: 'tool_result', tool: 'lookup', text: 'Result data.' },
      ],
    };
    for (const evidence of [
      '[user] Actual answer.',
      '[agent]',
      'lookup',
      '[tool_result lookup]',
      '[agent] Invented answer.',
      '[agent] Actual ans',
    ])
      expect(groundEvidence(request, { outcome: 'pass', reasoning: '', evidence }).grounded).toBe(false);
    expect(
      groundEvidence(request, {
        outcome: 'pass',
        reasoning: '',
        evidence: '[tool_result lookup] Result data.',
      }),
    ).toEqual({ grounded: true, where: 'transcript.1' });
  });
});
