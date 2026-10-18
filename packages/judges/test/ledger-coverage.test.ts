import { describe, expect, it } from 'vitest';
import { parseJudgeText } from '../src/assessment';
import type { JudgeRequest } from '../src/contract';

const request = {
  criterion: { name: 'facts', rubric: 'State the upload and setup fee.' },
  transcript: [{ role: 'agent' as const, text: 'Upload 352 Mbps; setup 28 USD.' }],
  requirements: [
    { id: 'upload', requirement: 'State upload 352 Mbps.' },
    { id: 'setup', requirement: 'State setup 28 USD.' },
  ],
} as JudgeRequest & { requirements: { id: string; requirement: string }[] };
const check = (id: string, met: boolean | null = true) => ({
  id,
  reasoning: 'The stated facts match.',
  evidence: 'Upload 352 Mbps; setup 28 USD.',
  met,
});

describe('caller-owned requirement coverage', () => {
  it('names an invalid caller requirement set instead of reporting invalid JSON', () => {
    const raw = JSON.stringify({ checks: [check('upload'), check('setup')] });
    for (const requirements of [
      [],
      [
        { id: 'upload', requirement: 'one' },
        { id: 'upload', requirement: 'two' },
      ],
      [{ id: '', requirement: 'one' }],
    ]) {
      const result = parseJudgeText(raw, { ...request, requirements });
      expect(result.unparsed).toBe(true);
      expect(result.answer.reasoning).toContain('invalid caller requirements');
      expect(result.answer.reasoning).not.toContain('invalid JSON');
    }
  });
  it('never accepts an omitted or invented requirement from the former open-ended contract', () => {
    const raw = JSON.stringify({
      checks: [
        {
          requirement: 'Invented easy requirement.',
          reasoning: 'Looks good',
          evidence: 'Upload 352 Mbps; setup 28 USD.',
          met: true,
        },
      ],
    });
    expect(parseJudgeText(raw, request).unparsed).toBe(true);
  });
  it('requires every known id exactly once, independent of output order', () => {
    expect(
      parseJudgeText(JSON.stringify({ checks: [check('setup'), check('upload')] }), request).answer.outcome,
    ).toBe('pass');
    for (const checks of [[check('upload')], [check('upload'), check('upload')]])
      expect(parseJudgeText(JSON.stringify({ checks }), request).unparsed).toBe(true);
  });
  it('ignores and logs an unknown id without letting it change a complete verdict', () => {
    const result = parseJudgeText(
      JSON.stringify({ checks: [check('upload'), check('invented_access', null), check('setup')] }),
      request,
    );
    expect(result.answer.outcome).toBe('pass');
    expect(result).toHaveProperty('ignoredRequirementIds', ['invented_access']);
  });
});
